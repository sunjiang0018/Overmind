/**
 * Assimilator: Hivemind collective and code anti-tampering system (Disabled)
 */
export default class Assimilator implements IAssimilator {

	validate(target: any): void {
		// Disabled
	}

	generateChecksum(verbose = false): string {
		return '0x0';
	}

	isAssimilated(username: string): boolean {
		return false;
	}

	getClearanceCode(username: string): string | null {
		return null;
	}

	updateValidChecksumLedger(): void {
		// Disabled
	}

	run(): void {
		// Disabled
	}

}
