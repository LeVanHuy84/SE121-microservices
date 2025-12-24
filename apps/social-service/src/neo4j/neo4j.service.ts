import { Inject, Injectable, OnApplicationShutdown } from '@nestjs/common';
import neo4j, {
  Driver,
  int,
  QueryResult,
  Session,
  Transaction,
} from 'neo4j-driver';
import type { Neo4jConfig } from './neo4j-config.interface';
import { NEO4J_CONFIG, NEO4J_DRIVER } from './neo4j.constants';

@Injectable()
export class Neo4jService implements OnApplicationShutdown {
  constructor(
    @Inject(NEO4J_CONFIG) private readonly config: Neo4jConfig,
    @Inject(NEO4J_DRIVER) private readonly driver: Driver,
  ) {}

  getDriver(): Driver {
    return this.driver;
  }

  getConfig(): Neo4jConfig {
    return this.config;
  }

  int(value: number) {
    return int(value);
  }

  beginTransaction(database?: string): Transaction {
    const session = this.getWriteSession(database);

    return session.beginTransaction();
  }

  beginTransactionWithSession(database?: string): {
    session: Session;
    tx: Transaction;
  } {
    const session = this.getWriteSession(database);
    const tx = session.beginTransaction();
    return { session, tx };
  }

  getReadSession(database?: string) {
    return this.driver.session({
      database: database || this.config.database,
      defaultAccessMode: neo4j.session.READ,
    });
  }

  getWriteSession(database?: string) {
    return this.driver.session({
      database: database || this.config.database,
      defaultAccessMode: neo4j.session.WRITE,
    });
  }

  async read(
    cypher: string,
    params?: Record<string, any>,
    databaseOrTransaction?: string | Transaction,
  ): Promise<QueryResult> {
    if (databaseOrTransaction instanceof Transaction) {
      return databaseOrTransaction.run(cypher, params);
    }

    const session = this.getReadSession(<string>databaseOrTransaction);
    try {
      return await session.run(cypher, params);
    } finally {
      await session.close();
    }
  }

  async write(
    cypher: string,
    params?: Record<string, any>,
    databaseOrTransaction?: string | Transaction,
  ): Promise<QueryResult> {
    if (databaseOrTransaction instanceof Transaction) {
      return databaseOrTransaction.run(cypher, params);
    }

    const session = this.getWriteSession(<string>databaseOrTransaction);
    try {
      return await session.run(cypher, params);
    } finally {
      await session.close();
    }
  }

  onApplicationShutdown() {
    return this.driver.close();
  }
}
