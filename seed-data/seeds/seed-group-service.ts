import 'reflect-metadata';

import * as dotenv from 'dotenv';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';

type RawMediaItem = {
  type: string;
  url: string;
  publicId?: string;
  fileName?: string;
  mimeType?: string;
  size?: number;
  duration?: number;
  thumbnailUrl?: string;
};

type RawGroupOwner = {
  id: string;
  fullName: string;
  avatarUrl?: string;
};

type RawGroupMember = {
  id: string;
  userId: string;
  groupId: string;
  role: string;
  customPermissions?: string[];
  status: string;
  createdAt: string;
  updatedAt: string;
};

type RawGroupJoinRequest = {
  id: string;
  userId: string;
  groupId: string;
  status: string;
  createdBy?: string;
  updatedBy?: string;
  createdAt: string;
  updatedAt: string;
};

type RawGroupInvite = {
  id: string;
  inviters?: string[];
  inviteeId: string;
  status: string;
  expiredAt?: string | null;
  groupId: string;
  createdAt: string;
  updatedAt: string;
};

type RawGroupReport = {
  id: string;
  reporterId: string;
  groupId: string;
  reason?: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
};

type RawGroupLog = {
  id: string;
  groupId: string;
  userId: string;
  eventType: string;
  content?: string | null;
  createdAt: string;
  updatedAt: string;
};

type RawGroupSetting = {
  groupId: string;
  requiredPostApproval: boolean;
  allowMemberInvite: boolean;
  maxMembers: number;
  createdBy?: string;
  updatedBy?: string;
  createdAt: string;
  updatedAt: string;
};

type RawGroupStatistic = {
  id: string;
  groupId: string;
  date: string;
  postCount: number;
  joinCount: number;
  leaveCount: number;
};

type RawGroupSeed = {
  id: string;
  name: string;
  description?: string | null;
  avatar?: RawMediaItem | null;
  coverImage?: RawMediaItem | null;
  privacy: string;
  rules?: string | null;
  members: number;
  reports: number;
  owner: RawGroupOwner;
  status: string;
  createdBy?: string;
  updatedBy?: string;
  createdAt: string;
  updatedAt: string;
  groupSetting?: RawGroupSetting | null;
  groupMembers?: RawGroupMember[];
  groupJoinRequests?: RawGroupJoinRequest[];
  groupInvites?: RawGroupInvite[];
  groupReports?: RawGroupReport[];
  groupLogs?: RawGroupLog[];
  statistics?: RawGroupStatistic[];
};

type GroupSeedBundle = {
  groups: Array<{
    id: string;
    name: string;
    description: string | null;
    avatar: RawMediaItem | null;
    coverImage: RawMediaItem | null;
    privacy: string;
    rules: string | null;
    members: number;
    reports: number;
    owner: RawGroupOwner;
    status: string;
    createdBy: string | null;
    updatedBy: string | null;
    createdAt: Date;
    updatedAt: Date;
  }>;
  groupSettings: Array<{
    groupId: string;
    requiredPostApproval: boolean;
    allowMemberInvite: boolean;
    maxMembers: number;
    createdBy: string | null;
    updatedBy: string | null;
    createdAt: Date;
    updatedAt: Date;
  }>;
  groupMembers: Array<{
    id: string;
    userId: string;
    groupId: string;
    role: string;
    customPermissions: string[];
    status: string;
    createdAt: Date;
    updatedAt: Date;
  }>;
  groupJoinRequests: Array<{
    id: string;
    userId: string;
    groupId: string;
    status: string;
    createdBy: string | null;
    updatedBy: string | null;
    createdAt: Date;
    updatedAt: Date;
  }>;
  groupInvites: Array<{
    id: string;
    inviters: string[];
    inviteeId: string;
    status: string;
    expiredAt: Date | null;
    groupId: string;
    createdAt: Date;
    updatedAt: Date;
  }>;
  groupReports: Array<{
    id: string;
    reporterId: string;
    groupId: string;
    reason: string | null;
    status: string;
    createdAt: Date;
    updatedAt: Date;
  }>;
  groupLogs: Array<{
    id: string;
    groupId: string;
    userId: string;
    eventType: string;
    content: string | null;
    createdAt: Date;
    updatedAt: Date;
  }>;
  statistics: Array<{
    id: string;
    groupId: string;
    date: string;
    postCount: number;
    joinCount: number;
    leaveCount: number;
  }>;
};

const ROOT_DIR = resolve(__dirname, '../..');
const DATA_FILE = resolve(__dirname, '../data/group-seed.json');
const ENV_CANDIDATES = [
  resolve(ROOT_DIR, 'apps/group-service/.env'),
  resolve(ROOT_DIR, 'apps/group-service/.env.local'),
];
const REQUIRED_TABLES = [
  'groups',
  'group_settings',
  'group_members',
  'group_join_requests',
  'group_invites',
  'group_reports',
  'group_logs',
  'group_statistics',
];
const CLEANUP_TABLES = [...REQUIRED_TABLES, 'outbox_event', 'processed_events'];

function loadGroupServiceEnv(): string {
  for (const envFile of ENV_CANDIDATES) {
    if (!existsSync(envFile)) {
      continue;
    }

    dotenv.config({ path: envFile });

    if (process.env.GROUP_DATABASE_URL) {
      return envFile;
    }
  }

  throw new Error(
    'Unable to find GROUP_DATABASE_URL. Expected apps/group-service/.env or .env.local',
  );
}

function loadRawGroups(): RawGroupSeed[] {
  const content = readFileSync(DATA_FILE, 'utf-8').replace(/^\uFEFF/, '');
  const parsed = JSON.parse(content) as unknown;

  if (!Array.isArray(parsed)) {
    throw new Error('group-seed.json must contain an array of groups');
  }

  return parsed as RawGroupSeed[];
}

function buildSeedBundle(rawGroups: RawGroupSeed[]): GroupSeedBundle {
  const bundle: GroupSeedBundle = {
    groups: [],
    groupSettings: [],
    groupMembers: [],
    groupJoinRequests: [],
    groupInvites: [],
    groupReports: [],
    groupLogs: [],
    statistics: [],
  };

  for (const rawGroup of rawGroups) {
    const createdAt = new Date(rawGroup.createdAt);
    const updatedAt = new Date(rawGroup.updatedAt);

    bundle.groups.push({
      id: rawGroup.id,
      name: rawGroup.name,
      description: rawGroup.description ?? null,
      avatar: rawGroup.avatar ?? null,
      coverImage: rawGroup.coverImage ?? null,
      privacy: rawGroup.privacy,
      rules: rawGroup.rules ?? null,
      members: rawGroup.members,
      reports: rawGroup.reports,
      owner: rawGroup.owner,
      status: rawGroup.status,
      createdBy: rawGroup.createdBy ?? null,
      updatedBy: rawGroup.updatedBy ?? null,
      createdAt,
      updatedAt,
    });

    if (rawGroup.groupSetting) {
      bundle.groupSettings.push({
        groupId: rawGroup.groupSetting.groupId,
        requiredPostApproval: rawGroup.groupSetting.requiredPostApproval,
        allowMemberInvite: rawGroup.groupSetting.allowMemberInvite,
        maxMembers: rawGroup.groupSetting.maxMembers,
        createdBy: rawGroup.groupSetting.createdBy ?? null,
        updatedBy: rawGroup.groupSetting.updatedBy ?? null,
        createdAt: new Date(rawGroup.groupSetting.createdAt),
        updatedAt: new Date(rawGroup.groupSetting.updatedAt),
      });
    }

    for (const rawMember of rawGroup.groupMembers ?? []) {
      bundle.groupMembers.push({
        id: rawMember.id,
        userId: rawMember.userId,
        groupId: rawMember.groupId,
        role: rawMember.role,
        customPermissions: rawMember.customPermissions ?? [],
        status: rawMember.status,
        createdAt: new Date(rawMember.createdAt),
        updatedAt: new Date(rawMember.updatedAt),
      });
    }

    for (const rawRequest of rawGroup.groupJoinRequests ?? []) {
      bundle.groupJoinRequests.push({
        id: rawRequest.id,
        userId: rawRequest.userId,
        groupId: rawRequest.groupId,
        status: rawRequest.status,
        createdBy: rawRequest.createdBy ?? null,
        updatedBy: rawRequest.updatedBy ?? null,
        createdAt: new Date(rawRequest.createdAt),
        updatedAt: new Date(rawRequest.updatedAt),
      });
    }

    for (const rawInvite of rawGroup.groupInvites ?? []) {
      bundle.groupInvites.push({
        id: rawInvite.id,
        inviters: rawInvite.inviters ?? [],
        inviteeId: rawInvite.inviteeId,
        status: rawInvite.status,
        expiredAt: rawInvite.expiredAt ? new Date(rawInvite.expiredAt) : null,
        groupId: rawInvite.groupId,
        createdAt: new Date(rawInvite.createdAt),
        updatedAt: new Date(rawInvite.updatedAt),
      });
    }

    for (const rawReport of rawGroup.groupReports ?? []) {
      bundle.groupReports.push({
        id: rawReport.id,
        reporterId: rawReport.reporterId,
        groupId: rawReport.groupId,
        reason: rawReport.reason ?? null,
        status: rawReport.status,
        createdAt: new Date(rawReport.createdAt),
        updatedAt: new Date(rawReport.updatedAt),
      });
    }

    for (const rawLog of rawGroup.groupLogs ?? []) {
      bundle.groupLogs.push({
        id: rawLog.id,
        groupId: rawLog.groupId,
        userId: rawLog.userId,
        eventType: rawLog.eventType,
        content: rawLog.content ?? null,
        createdAt: new Date(rawLog.createdAt),
        updatedAt: new Date(rawLog.updatedAt),
      });
    }

    for (const rawStatistic of rawGroup.statistics ?? []) {
      bundle.statistics.push({
        id: rawStatistic.id,
        groupId: rawStatistic.groupId,
        date: rawStatistic.date,
        postCount: rawStatistic.postCount,
        joinCount: rawStatistic.joinCount,
        leaveCount: rawStatistic.leaveCount,
      });
    }
  }

  return bundle;
}

function chunkArray<T>(items: T[], size: number): T[][] {
  if (size <= 0) {
    throw new Error('Chunk size must be greater than 0');
  }

  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

function buildPgClient(): Client {
  const databaseUrl = process.env.GROUP_DATABASE_URL;

  if (!databaseUrl) {
    throw new Error('GROUP_DATABASE_URL is missing after loading env file');
  }

  return new Client({ connectionString: databaseUrl });
}

function quoteIdent(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function jsonbValue<T>(value: T | null): string | null {
  return value === null ? null : JSON.stringify(value);
}

function normalizeInviteStatus(value: string): string {
  if (value === 'APPROVED') {
    return 'ACCEPTED';
  }

  if (value === 'REJECTED') {
    return 'DECLINED';
  }

  return value;
}

async function ensureRequiredTablesExist(client: Client): Promise<void> {
  const result = await client.query<{ table_name: string }>(
    `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = current_schema()
        AND table_name = ANY($1::text[])
    `,
    [REQUIRED_TABLES],
  );

  const existing = new Set(result.rows.map((row) => row.table_name));
  const missing = REQUIRED_TABLES.filter(
    (tableName) => !existing.has(tableName),
  );

  if (missing.length > 0) {
    throw new Error(
      `Missing group-service tables: ${missing.join(', ')}. Run migrations before seeding.`,
    );
  }
}

async function truncateExistingTables(client: Client): Promise<void> {
  const result = await client.query<{ table_name: string }>(
    `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = current_schema()
        AND table_name = ANY($1::text[])
    `,
    [CLEANUP_TABLES],
  );

  const tableNames = result.rows.map((row) => row.table_name);

  if (tableNames.length === 0) {
    return;
  }

  const quotedTables = tableNames
    .map((tableName) => quoteIdent(tableName))
    .join(', ');

  await client.query(`TRUNCATE TABLE ${quotedTables} RESTART IDENTITY CASCADE`);
}

async function insertRows(
  client: Client,
  tableName: string,
  columns: string[],
  rows: Array<Record<string, unknown>>,
): Promise<void> {
  if (rows.length === 0) {
    return;
  }

  const quotedColumns = columns.map((column) => quoteIdent(column)).join(', ');
  const valueGroups: string[] = [];
  const values: unknown[] = [];

  rows.forEach((row, rowIndex) => {
    const placeholders = columns.map((_, columnIndex) => {
      values.push(row[columns[columnIndex]]);
      return `$${rowIndex * columns.length + columnIndex + 1}`;
    });

    valueGroups.push(`(${placeholders.join(', ')})`);
  });

  await client.query(
    `INSERT INTO ${quoteIdent(tableName)} (${quotedColumns}) VALUES ${valueGroups.join(', ')}`,
    values,
  );
}

async function main(): Promise<void> {
  const envFile = loadGroupServiceEnv();
  const rawGroups = loadRawGroups();
  const seedBundle = buildSeedBundle(rawGroups);
  const client = buildPgClient();

  await client.connect();

  try {
    await client.query('BEGIN');

    await ensureRequiredTablesExist(client);
    await truncateExistingTables(client);

    await insertRows(
      client,
      'groups',
      [
        'id',
        'name',
        'description',
        'avatar',
        'cover_image',
        'privacy',
        'rules',
        'members',
        'reports',
        'owner',
        'status',
        'created_by',
        'updated_by',
        'created_at',
        'updated_at',
      ],
      seedBundle.groups.map((group) => ({
        id: group.id,
        name: group.name,
        description: group.description,
        avatar: jsonbValue(group.avatar),
        cover_image: jsonbValue(group.coverImage),
        privacy: group.privacy,
        rules: group.rules,
        members: group.members,
        reports: group.reports,
        owner: jsonbValue(group.owner),
        status: group.status,
        created_by: group.createdBy,
        updated_by: group.updatedBy,
        created_at: group.createdAt,
        updated_at: group.updatedAt,
      })),
    );

    await insertRows(
      client,
      'group_settings',
      [
        'group_id',
        'required_post_approval',
        'allow_member_invite',
        'max_members',
        'created_by',
        'updated_by',
        'created_at',
        'updated_at',
      ],
      seedBundle.groupSettings.map((setting) => ({
        group_id: setting.groupId,
        required_post_approval: setting.requiredPostApproval,
        allow_member_invite: setting.allowMemberInvite,
        max_members: setting.maxMembers,
        created_by: setting.createdBy,
        updated_by: setting.updatedBy,
        created_at: setting.createdAt,
        updated_at: setting.updatedAt,
      })),
    );

    await insertRows(
      client,
      'group_members',
      [
        'id',
        'user_id',
        'group_id',
        'role',
        'customPermissions',
        'status',
        'created_at',
        'updated_at',
      ],
      seedBundle.groupMembers.map((member) => ({
        id: member.id,
        user_id: member.userId,
        group_id: member.groupId,
        role: member.role,
        customPermissions: jsonbValue(member.customPermissions),
        status: member.status,
        created_at: member.createdAt,
        updated_at: member.updatedAt,
      })),
    );

    await insertRows(
      client,
      'group_join_requests',
      [
        'id',
        'user_id',
        'group_id',
        'status',
        'created_by',
        'updated_by',
        'created_at',
        'updated_at',
      ],
      seedBundle.groupJoinRequests.map((request) => ({
        id: request.id,
        user_id: request.userId,
        group_id: request.groupId,
        status: request.status,
        created_by: request.createdBy,
        updated_by: request.updatedBy,
        created_at: request.createdAt,
        updated_at: request.updatedAt,
      })),
    );

    await insertRows(
      client,
      'group_invites',
      [
        'id',
        'inviters',
        'invitee_id',
        'status',
        'expired_at',
        'group_id',
        'created_at',
        'updated_at',
      ],
      seedBundle.groupInvites.map((invite) => ({
        id: invite.id,
        inviters: invite.inviters,
        invitee_id: invite.inviteeId,
        status: normalizeInviteStatus(invite.status),
        expired_at: invite.expiredAt,
        group_id: invite.groupId,
        created_at: invite.createdAt,
        updated_at: invite.updatedAt,
      })),
    );

    await insertRows(
      client,
      'group_reports',
      [
        'id',
        'reporter_id',
        'group_id',
        'reason',
        'status',
        'created_at',
        'updated_at',
      ],
      seedBundle.groupReports.map((report) => ({
        id: report.id,
        reporter_id: report.reporterId,
        group_id: report.groupId,
        reason: report.reason,
        status: report.status,
        created_at: report.createdAt,
        updated_at: report.updatedAt,
      })),
    );

    await insertRows(
      client,
      'group_logs',
      [
        'id',
        'group_id',
        'user_id',
        'event_type',
        'content',
        'created_at',
        'updated_at',
      ],
      seedBundle.groupLogs.map((log) => ({
        id: log.id,
        group_id: log.groupId,
        user_id: log.userId,
        event_type: log.eventType,
        content: log.content,
        created_at: log.createdAt,
        updated_at: log.updatedAt,
      })),
    );

    await insertRows(
      client,
      'group_statistics',
      ['id', 'group_id', 'date', 'post_count', 'join_count', 'leave_count'],
      seedBundle.statistics.map((statistic) => ({
        id: statistic.id,
        group_id: statistic.groupId,
        date: statistic.date,
        post_count: statistic.postCount,
        join_count: statistic.joinCount,
        leave_count: statistic.leaveCount,
      })),
    );

    await client.query('COMMIT');

    console.log(
      `Seeded group-service from ${DATA_FILE} using ${envFile}: ${seedBundle.groups.length} groups`,
    );
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[seed-group-service] ${message}`);
  process.exitCode = 1;
});
