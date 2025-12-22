export const EPOCH = 1753570766000n;
const TIMESTAMP_BITS = 41n;
const MACHINE_ID_BITS = 5n;
const SEQUENCE_BITS = 17n;

const MAX_MACHINE_ID = (1n << MACHINE_ID_BITS) - 1n;
const MAX_SEQUENCE = (1n << SEQUENCE_BITS) - 1n;

const MACHINE_ID_SHIFT = SEQUENCE_BITS;
export const TIMESTAMP_SHIFT = SEQUENCE_BITS + MACHINE_ID_BITS;

class SnowflakeGenerator {
  private machineId: bigint;
  private sequence: bigint = 0n;
  private lastTimestamp: bigint = 0n;

  constructor(machineId?: number) {
    const envMachineId = process.env.MACHINE_ID
      ? parseInt(process.env.MACHINE_ID)
      : undefined;
    const finalMachineId = machineId ?? envMachineId ?? 0;
    if (finalMachineId < 0 || finalMachineId > Number(MAX_MACHINE_ID)) {
      throw new Error(`Machine ID must be between 0 and ${MAX_MACHINE_ID}`);
    }
    this.machineId = BigInt(finalMachineId);
  }

  private getCurrentTimestamp(): bigint {
    return BigInt(Date.now()) - EPOCH;
  }

  private waitForNextTimestamp(lastTimestamp: bigint): bigint {
    let timestamp = this.getCurrentTimestamp();
    while (timestamp <= lastTimestamp) {
      timestamp = this.getCurrentTimestamp();
    }
    return timestamp;
  }

  generate(): string {
    let timestamp = this.getCurrentTimestamp();

    if (timestamp < this.lastTimestamp) {
      throw new Error('Clock moved backwards. Refusing to generate ID');
    }

    if (timestamp === this.lastTimestamp) {
      this.sequence = (this.sequence + 1n) & MAX_SEQUENCE;
      if (this.sequence === 0n) {
        timestamp = this.waitForNextTimestamp(this.lastTimestamp);
      }
    } else {
      this.sequence = 0n;
    }

    this.lastTimestamp = timestamp;

    const id =
      (timestamp << TIMESTAMP_SHIFT) |
      (this.machineId << MACHINE_ID_SHIFT) |
      this.sequence;

    return id.toString();
  }
}

const defaultGenerator = new SnowflakeGenerator();

export function snowflakeId(): string {
  return defaultGenerator.generate();
}

export { SnowflakeGenerator };
