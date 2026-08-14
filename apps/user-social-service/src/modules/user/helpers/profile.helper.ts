export class ProfileHelper {
  static normalizeOptionalText(
    value: string | null | undefined,
  ): string | null {
    if (typeof value !== "string") {
      return value ?? null;
    }

    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }

  static normalizeInterests(interests: string[] | undefined): string[] {
    if (!Array.isArray(interests)) {
      return [];
    }

    return [
      ...new Set(interests.map((item) => item.trim()).filter(Boolean)),
    ].slice(0, 10);
  }

  static normalizeComparableText(value: string | null | undefined): string {
    return typeof value === "string" ? value.trim().toLowerCase() : "";
  }

  static matchesNormalizedText(
    left: string | null | undefined,
    right: string | null | undefined,
  ): boolean {
    const normalizedLeft = this.normalizeComparableText(left);
    const normalizedRight = this.normalizeComparableText(right);
    return Boolean(normalizedLeft) && normalizedLeft === normalizedRight;
  }
}
