import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';
import { ServiceAccount } from 'firebase-admin';
import * as path from 'path';

export interface FirebasePushOptions {
  collapseKey?: string;
  androidTag?: string;
  androidChannelId?: string;
  apnsCollapseId?: string;
  apnsThreadId?: string;
  apnsSummaryArg?: string;
  apnsSummaryArgCount?: number;
}

@Injectable()
export class FirebaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FirebaseService.name);
  private firebaseApp: admin.app.App;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    this.initializeFirebase();
  }

  async onModuleDestroy() {
    try {
      if (this.firebaseApp) {
        await this.firebaseApp.delete();
        this.logger.log('Firebase Admin SDK instance destroyed');
      }
    } catch (error) {
      this.logger.error('Error destroying Firebase Admin SDK', error);
    }
  }

  private initializeFirebase() {
    try {
      // Check if Firebase app exists and is still valid
      if (admin.apps.length > 0) {
        const existingApp = admin.app();
        // Check if app is not deleted
        try {
          existingApp.name; // This will throw if app is deleted
          this.firebaseApp = existingApp;
          this.logger.log('Using existing Firebase Admin SDK instance');
          return;
        } catch {
          // App exists but is deleted, need to reinitialize
          this.logger.warn('Existing Firebase app is deleted, reinitializing...');
        }
      }

      const serviceAccountPath = this.configService.get<string>(
        'FIREBASE_SERVICE_ACCOUNT_PATH'
      );
      const projectId = this.configService.get<string>('FIREBASE_PROJECT_ID');

      // Option 1: Load from file path
      if (serviceAccountPath) {
        // Resolve path relative to project root (process.cwd())
        const resolvedPath = path.isAbsolute(serviceAccountPath)
          ? serviceAccountPath
          : path.resolve(process.cwd(), serviceAccountPath);
        const serviceAccount = require(resolvedPath) as ServiceAccount;
        this.firebaseApp = admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
        });
      }
      // Option 2: Load from environment variables
      else if (projectId) {
        const serviceAccount: ServiceAccount = {
          projectId: this.configService.get<string>('FIREBASE_PROJECT_ID'),
          clientEmail: this.configService.get<string>(
            'FIREBASE_CLIENT_EMAIL'
          ),
          privateKey: this.configService
            .get<string>('FIREBASE_PRIVATE_KEY')
            ?.replace(/\\n/g, '\n'),
        };

        this.firebaseApp = admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
        });
      } else {
        this.logger.warn(
          'Firebase credentials not configured. FCM notifications will be disabled.'
        );
        return;
      }

      this.logger.log('Firebase Admin SDK initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize Firebase Admin SDK', error);
    }
  }

  async sendToDevice(
    token: string,
    title: string,
    body: string,
    data?: Record<string, string>,
    options?: FirebasePushOptions,
  ): Promise<{ success: boolean; error?: string }> {
    if (!this.firebaseApp) {
      return { success: false, error: 'Firebase not initialized' };
    }

    try {
      const message: admin.messaging.Message = {
        notification: {
          title,
          body,
        },
        data: data || {},
        token,
        android: {
          priority: 'high',
          collapseKey: options?.collapseKey,
          notification: {
            sound: 'default',
            channelId: options?.androidChannelId || 'default',
            tag: options?.androidTag,
          },
        },
        apns: {
          headers: options?.apnsCollapseId
            ? {
                'apns-collapse-id': options.apnsCollapseId,
              }
            : undefined,
          payload: {
            aps: {
              alert: {
                title,
                body,
              },
              sound: 'default',
              badge: 1,
              'thread-id': options?.apnsThreadId,
              'summary-arg': options?.apnsSummaryArg,
              'summary-arg-count': options?.apnsSummaryArgCount,
            },
          },
        },
      };

      const response = await admin.messaging().send(message);
      this.logger.log(`Successfully sent message: ${response}`);
      return { success: true };
    } catch (error) {
      this.logger.error('Error sending FCM message:', error);
      return { success: false, error: error.message };
    }
  }

  async sendToMultipleDevices(
    tokens: string[],
    title: string,
    body: string,
    data?: Record<string, string>,
    options?: FirebasePushOptions,
  ): Promise<{
    successCount: number;
    failureCount: number;
    invalidTokens: string[];
  }> {
    if (!this.firebaseApp) {
      return { successCount: 0, failureCount: tokens.length, invalidTokens: [] };
    }

    if (tokens.length === 0) {
      return { successCount: 0, failureCount: 0, invalidTokens: [] };
    }

    try {
      const message: admin.messaging.MulticastMessage = {
        notification: {
          title,
          body,
        },
        data: data || {},
        tokens,
        android: {
          priority: 'high',
          collapseKey: options?.collapseKey,
          notification: {
            sound: 'default',
            channelId: options?.androidChannelId || 'default',
            tag: options?.androidTag,
          },
        },
        apns: {
          headers: options?.apnsCollapseId
            ? {
                'apns-collapse-id': options.apnsCollapseId,
              }
            : undefined,
          payload: {
            aps: {
              alert: {
                title,
                body,
              },
              sound: 'default',
              badge: 1,
              'thread-id': options?.apnsThreadId,
              'summary-arg': options?.apnsSummaryArg,
              'summary-arg-count': options?.apnsSummaryArgCount,
            },
          },
        },
      };

      const response = await admin.messaging().sendEachForMulticast(message);

      // Collect invalid tokens
      const invalidTokens: string[] = [];
      response.responses.forEach((resp, idx) => {
        if (!resp.success && resp.error) {
          const errorCode = resp.error.code;
          if (
            errorCode === 'messaging/invalid-registration-token' ||
            errorCode === 'messaging/registration-token-not-registered'
          ) {
            invalidTokens.push(tokens[idx]);
          }
        }
      });

      this.logger.log(
        `Sent to ${response.successCount}/${tokens.length} devices`
      );

      return {
        successCount: response.successCount,
        failureCount: response.failureCount,
        invalidTokens,
      };
    } catch (error) {
      this.logger.error('Error sending multicast FCM message:', error);
      return {
        successCount: 0,
        failureCount: tokens.length,
        invalidTokens: [],
      };
    }
  }

  async sendDataOnlyToMultipleDevices(
    tokens: string[],
    data: Record<string, string>,
    options?: Pick<FirebasePushOptions, 'collapseKey'>
  ): Promise<{
    successCount: number;
    failureCount: number;
    invalidTokens: string[];
  }> {
    if (!this.firebaseApp) {
      return { successCount: 0, failureCount: tokens.length, invalidTokens: [] };
    }

    if (tokens.length === 0) {
      return { successCount: 0, failureCount: 0, invalidTokens: [] };
    }

    try {
      const message: admin.messaging.MulticastMessage = {
        data,
        tokens,
        android: {
          priority: 'high',
          collapseKey: options?.collapseKey,
        },
      };

      const response = await admin.messaging().sendEachForMulticast(message);
      const invalidTokens: string[] = [];

      response.responses.forEach((resp, idx) => {
        if (!resp.success && resp.error) {
          const errorCode = resp.error.code;
          if (
            errorCode === 'messaging/invalid-registration-token' ||
            errorCode === 'messaging/registration-token-not-registered'
          ) {
            invalidTokens.push(tokens[idx]);
          }
        }
      });

      this.logger.log(
        `Sent data-only push to ${response.successCount}/${tokens.length} devices`
      );

      return {
        successCount: response.successCount,
        failureCount: response.failureCount,
        invalidTokens,
      };
    } catch (error) {
      this.logger.error('Error sending data-only multicast FCM message:', error);
      return {
        successCount: 0,
        failureCount: tokens.length,
        invalidTokens: [],
      };
    }
  }

  async sendToTopic(
    topic: string,
    title: string,
    body: string,
    data?: Record<string, string>
  ): Promise<{ success: boolean; error?: string }> {
    if (!this.firebaseApp) {
      return { success: false, error: 'Firebase not initialized' };
    }

    try {
      const message: admin.messaging.Message = {
        notification: {
          title,
          body,
        },
        data: data || {},
        topic,
      };

      const response = await admin.messaging().send(message);
      this.logger.log(`Successfully sent topic message: ${response}`);
      return { success: true };
    } catch (error) {
      this.logger.error('Error sending FCM topic message:', error);
      return { success: false, error: error.message };
    }
  }

  async subscribeToTopic(
    tokens: string[],
    topic: string
  ): Promise<{ success: boolean; error?: string }> {
    if (!this.firebaseApp) {
      return { success: false, error: 'Firebase not initialized' };
    }

    try {
      await admin.messaging().subscribeToTopic(tokens, topic);
      this.logger.log(`Subscribed ${tokens.length} devices to topic: ${topic}`);
      return { success: true };
    } catch (error) {
      this.logger.error('Error subscribing to topic:', error);
      return { success: false, error: error.message };
    }
  }

  async unsubscribeFromTopic(
    tokens: string[],
    topic: string
  ): Promise<{ success: boolean; error?: string }> {
    if (!this.firebaseApp) {
      return { success: false, error: 'Firebase not initialized' };
    }

    try {
      await admin.messaging().unsubscribeFromTopic(tokens, topic);
      this.logger.log(
        `Unsubscribed ${tokens.length} devices from topic: ${topic}`
      );
      return { success: true };
    } catch (error) {
      this.logger.error('Error unsubscribing from topic:', error);
      return { success: false, error: error.message };
    }
  }
}
