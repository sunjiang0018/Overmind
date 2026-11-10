import { Colony } from "../Colony";
import { getEnergyCapacity, getStoredEnergy } from "../game/Structures";
import { profile } from "../profiler/decorator";
import { remove, min } from "../utilities/native";

/**
 * The link network controls the flow of energy through various links in a room and uses a greedy matching algorithm
 * to determine where to send energy to
 */
@profile
export class LinkNetwork {
  colony: Colony;
  receive: StructureLink[];
  transmit: StructureLink[];

  private settings: {
    linksTrasmitAt: number;
  };

  constructor(colony: Colony) {
    this.colony = colony;
    this.receive = [];
    this.transmit = [];
    this.settings = {
      linksTrasmitAt: LINK_CAPACITY - 100,
    };
  }

  refresh(): void {
    this.receive = [];
    this.transmit = [];
  }

  claimLink(link: StructureLink | undefined): void {
    if (link) {
      remove(this.colony.availableLinks, (l) => l.id == link.id);
    }
  }

  requestReceive(link: StructureLink): void {
    this.receive.push(link);
  }

  requestTransmit(link: StructureLink): void {
    this.transmit.push(link);
  }

  /**
   * Number of ticks until a dropoff link is available again to deposit energy to
   */
  getDropoffAvailability(link: StructureLink): number {
    const dest = this.colony.commandCenter ? this.colony.commandCenter.pos : this.colony.pos;
    const usualCooldown = link.pos.getRangeTo(dest);
    if (getStoredEnergy(link) > this.settings.linksTrasmitAt) {
      // Energy will be sent next time cooldown == 0
      return link.cooldown + usualCooldown;
    } else {
      return link.cooldown;
    }
  }

  init(): void {
    // for (let link of this.colony.dropoffLinks) {
    // 	if (link.energy > this.settings.linksTrasmitAt) {
    // 		this.requestTransmit(link);
    // 	}
    // }
  }

  /** Route mine output through the storage-side hub before serving other sinks. */
  private runStorageFirst(): void {
    const core = this.colony.commandCenter?.link;
    const sent = new Set<string>();
    const received = new Set<string>();
    const send = (sender: StructureLink, receiver: StructureLink): boolean => {
      if (
        sender.id == receiver.id ||
        sent.has(sender.id) ||
        received.has(receiver.id) ||
        sender.cooldown > 0
      )
        return false;
      const amount = Math.min(
        getStoredEnergy(sender),
        getEnergyCapacity(receiver) - getStoredEnergy(receiver),
      );
      if (amount <= 0 || sender.transferEnergy(receiver, amount) != OK) return false;
      sent.add(sender.id);
      // One accepted packet per receiver avoids reserving the same capacity
      // twice while Screeps defers the actual store updates to tick end.
      received.add(receiver.id);
      remove(this.transmit, (link) => link.id == sender.id);
      return true;
    };
    const sendNearest = (receiver: StructureLink, senders: StructureLink[]): boolean => {
      const candidates = senders.filter(
        (sender) =>
          sender.id != receiver.id &&
          !sent.has(sender.id) &&
          sender.cooldown == 0 &&
          getStoredEnergy(sender) > 0,
      );
      while (candidates.length > 0) {
        const sender = receiver.pos.findClosestByRange(candidates)!;
        if (send(sender, receiver)) return true;
        remove(candidates, (candidate) => candidate.id == sender.id);
      }
      return false;
    };
    if (core) {
      sendNearest(
        core,
        this.transmit.filter((link) => link.id != core.id),
      );
    }
    for (const receiver of this.receive) {
      if (received.has(receiver.id) || receiver.id == core?.id) continue;
      // The hub can forward its existing surplus, so controller/hatchery
      // receivers still make progress while fresh mine output reaches storage.
      if (core && this.transmit.some((link) => link.id == core.id) && send(core, receiver)) {
        continue;
      }
      sendNearest(receiver, this.transmit);
    }
  }

  /**
   * Examine the link resource requests and try to efficiently (but greedily) match links that need energy in and
   * out, then send the remaining resourceOut link requests to the command center link
   */
  run(): void {
    if (this.colony.roomPlanner?.memory.logisticsPolicy?.storageLinkFirst) {
      this.runStorageFirst();
      return;
    }
    // For each receiving link, greedily get energy from the closest transmitting link - at most 9 operations
    for (const receiveLink of this.receive) {
      const closestTransmitLink = receiveLink.pos.findClosestByRange(this.transmit);
      // If a send-receive match is found, transfer that first, then remove the pair from the link lists
      if (closestTransmitLink) {
        // Send min of (all the energy in sender link, amount of available space in receiver link)
        const amountToSend = min([
          getStoredEnergy(closestTransmitLink),
          getEnergyCapacity(receiveLink) - getStoredEnergy(receiveLink),
        ]);
        closestTransmitLink.transferEnergy(receiveLink, amountToSend);
        remove(this.transmit, (link) => link == closestTransmitLink);
        // _.remove(this.receive, link => link == receiveLink);
      }
    }
    // Now send all remaining transmit link requests to the command center
    if (this.colony.commandCenter && this.colony.commandCenter.link) {
      for (const transmitLink of this.transmit) {
        transmitLink.transferEnergy(this.colony.commandCenter.link);
      }
    }
  }
}
