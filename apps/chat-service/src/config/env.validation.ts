type EnvShape = Record<string, unknown>;

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function validateEnv(config: EnvShape): EnvShape {
  const requiredKeys = ['STREAM_API_KEY', 'STREAM_API_SECRET'] as const;
  const missing = requiredKeys.filter((key) => !asNonEmptyString(config[key]));

  if (missing.length > 0) {
    throw new Error(
      `[chat-service] Missing required environment variables: ${missing.join(', ')}`,
    );
  }

  return config;
}
