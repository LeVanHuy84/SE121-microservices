import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';
import { ServiceAccount } from 'firebase-admin';

@Injectable()
export class FirebaseService implements OnModuleInit {
  private readonly logger = new Logger(FirebaseService.name);
  private firebaseApp: admin.app.App;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    this.initializeFirebase();
  }

  private initializeFirebase() {
    try {
      const serviceAccountPath = this.configService.get<string>(
        'FIREBASE_SERVICE_ACCOUNT_PATH'
      );
      const projectId = this.configService.get<string>('FIREBASE_PROJECT_ID');

      // Option 1: Load from file path
      if (serviceAccountPath) {
        const serviceAccount = require(serviceAccountPath) as ServiceAccount;
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
        token,
        android: {
          priority: 'high',
          notification: {
            sound: 'default',
            channelId: 'default',
          },
        },
        apns: {
          payload: {
            aps: {
              alert: {
                title,
                body,
              },
              sound: 'default',
              badge: 1,
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
    data?: Record<string, string>
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
          notification: {
            sound: 'default',
            channelId: 'default',
          },
        },
        apns: {
          payload: {
            aps: {
              alert: {
                title,
                body,
              },
              sound: 'default',
              badge: 1,
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
