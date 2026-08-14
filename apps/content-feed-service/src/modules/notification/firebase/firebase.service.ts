import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as admin from "firebase-admin";
import type { ServiceAccount } from "firebase-admin";
import * as path from "path";
import { NotificationDeliveryError } from "../notification/notification-delivery.error";

export interface FirebasePushOptions {
  collapseKey?: string;
  androidTag?: string;
  androidChannelId?: string;
  apnsCollapseId?: string;
  apnsThreadId?: string;
  apnsSummaryArg?: string;
  apnsSummaryArgCount?: number;
  apnsPriority?: number;
  apnsPushType?: string;
  contentAvailable?: boolean;
}

type MessagingErrorLike = Error & {
  code?: string;
  errorInfo?: {
    code?: string;
    message?: string;
  };
};

@Injectable()
export class FirebaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FirebaseService.name);
  private readonly partialRetryAttempts = 2;
  private readonly invalidTokenCodes = new Set([
    "messaging/invalid-registration-token",
    "messaging/registration-token-not-registered",
  ]);
  private readonly retryableErrorCodes = new Set([
    "app/network-error",
    "messaging/internal-error",
    "messaging/server-unavailable",
    "messaging/unknown-error",
    "messaging/quota-exceeded",
    "messaging/device-message-rate-exceeded",
    "messaging/topics-message-rate-exceeded",
  ]);
  private firebaseApp?: admin.app.App;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    this.initializeFirebase();
  }

  async onModuleDestroy() {
    try {
      if (this.firebaseApp) {
        await this.firebaseApp.delete();
        this.logger.log("Firebase Admin SDK instance destroyed");
      }
    } catch (error) {
      this.logger.error("Error destroying Firebase Admin SDK", error);
    }
  }

  async sendToDevice(
    token: string,
    title: string,
    body: string,
    data?: Record<string, string>,
    options?: FirebasePushOptions,
  ): Promise<{ success: boolean; error?: string }> {
    this.ensureInitialized();

    try {
      const response = await admin.messaging().send({
        notification: {
          title,
          body,
        },
        data: data || {},
        token,
        android: {
          priority: "high",
          collapseKey: options?.collapseKey,
          notification: {
            sound: "default",
            channelId: options?.androidChannelId || "default",
            tag: options?.androidTag,
          },
        },
        apns: {
          headers: options?.apnsCollapseId
            ? {
                "apns-collapse-id": options.apnsCollapseId,
              }
            : undefined,
          payload: {
            aps: {
              alert: {
                title,
                body,
              },
              sound: "default",
              badge: 1,
              "thread-id": options?.apnsThreadId,
              "summary-arg": options?.apnsSummaryArg,
              "summary-arg-count": options?.apnsSummaryArgCount,
            },
          },
        },
      });

      this.logger.log(`Successfully sent message: ${response}`);
      return { success: true };
    } catch (error) {
      throw this.createDeliveryError(
        "Error sending FCM message",
        this.classifyMessagingError(error),
        error,
      );
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
    this.ensureInitialized();

    if (tokens.length === 0) {
      return { successCount: 0, failureCount: 0, invalidTokens: [] };
    }

    try {
      const deliveryResult = await this.sendMulticastWithRetry(
        tokens,
        (batch) => ({
          notification: {
            title,
            body,
          },
          data: data || {},
          tokens: batch,
          android: {
            priority: "high",
            collapseKey: options?.collapseKey,
            notification: {
              sound: "default",
              channelId: options?.androidChannelId || "default",
              tag: options?.androidTag,
            },
          },
          apns: {
            headers: options?.apnsCollapseId
              ? {
                  "apns-collapse-id": options.apnsCollapseId,
                }
              : undefined,
            payload: {
              aps: {
                alert: {
                  title,
                  body,
                },
                sound: "default",
                badge: 1,
                "thread-id": options?.apnsThreadId,
                "summary-arg": options?.apnsSummaryArg,
                "summary-arg-count": options?.apnsSummaryArgCount,
              },
            },
          },
        }),
      );
      this.logger.log(
        `Sent to ${deliveryResult.successCount}/${tokens.length} devices`,
      );

      return deliveryResult;
    } catch (error) {
      throw this.createDeliveryError(
        "Error sending multicast FCM message",
        this.classifyMessagingError(error),
        error,
      );
    }
  }

  async sendDataOnlyToMultipleDevices(
    tokens: string[],
    data: Record<string, string>,
    options?: Pick<
      FirebasePushOptions,
      "collapseKey" | "apnsPriority" | "apnsPushType" | "contentAvailable"
    >,
  ): Promise<{
    successCount: number;
    failureCount: number;
    invalidTokens: string[];
  }> {
    this.ensureInitialized();

    if (tokens.length === 0) {
      return { successCount: 0, failureCount: 0, invalidTokens: [] };
    }

    try {
      const deliveryResult = await this.sendMulticastWithRetry(
        tokens,
        (batch) => ({
          data,
          tokens: batch,
          android: {
            priority: "high",
            collapseKey: options?.collapseKey,
          },
          apns: {
            headers: {
              ...(options?.apnsPriority && {
                "apns-priority": String(options.apnsPriority),
              }),
              ...(options?.apnsPushType && {
                "apns-push-type": options.apnsPushType,
              }),
            },
            payload: {
              aps: {
                contentAvailable: options?.contentAvailable ?? true,
              },
            },
          },
        }),
      );
      this.logger.log(
        `Sent data-only push to ${deliveryResult.successCount}/${tokens.length} devices`,
      );

      return deliveryResult;
    } catch (error) {
      throw this.createDeliveryError(
        "Error sending data-only multicast FCM message",
        this.classifyMessagingError(error),
        error,
      );
    }
  }

  async sendToTopic(
    topic: string,
    title: string,
    body: string,
    data?: Record<string, string>,
  ): Promise<{ success: boolean; error?: string }> {
    this.ensureInitialized();

    try {
      const response = await admin.messaging().send({
        notification: {
          title,
          body,
        },
        data: data || {},
        topic,
      });

      this.logger.log(`Successfully sent topic message: ${response}`);
      return { success: true };
    } catch (error) {
      throw this.createDeliveryError(
        "Error sending FCM topic message",
        this.classifyMessagingError(error),
        error,
      );
    }
  }

  async subscribeToTopic(
    tokens: string[],
    topic: string,
  ): Promise<{ success: boolean; error?: string }> {
    this.ensureInitialized();

    try {
      await admin.messaging().subscribeToTopic(tokens, topic);
      this.logger.log(`Subscribed ${tokens.length} devices to topic: ${topic}`);
      return { success: true };
    } catch (error) {
      throw this.createDeliveryError(
        "Error subscribing to topic",
        this.classifyMessagingError(error),
        error,
      );
    }
  }

  async unsubscribeFromTopic(
    tokens: string[],
    topic: string,
  ): Promise<{ success: boolean; error?: string }> {
    this.ensureInitialized();

    try {
      await admin.messaging().unsubscribeFromTopic(tokens, topic);
      this.logger.log(
        `Unsubscribed ${tokens.length} devices from topic: ${topic}`,
      );
      return { success: true };
    } catch (error) {
      throw this.createDeliveryError(
        "Error unsubscribing from topic",
        this.classifyMessagingError(error),
        error,
      );
    }
  }

  private initializeFirebase() {
    try {
      if (admin.apps.length > 0) {
        const existingApp = admin.app();

        try {
          existingApp.name;
          this.firebaseApp = existingApp;
          this.logger.log("Using existing Firebase Admin SDK instance");
          return;
        } catch {
          this.logger.warn(
            "Existing Firebase app is deleted, reinitializing...",
          );
        }
      }

      const serviceAccountPath = this.configService.get<string>(
        "FIREBASE_SERVICE_ACCOUNT_PATH",
      );
      const projectId = this.configService.get<string>("FIREBASE_PROJECT_ID");

      if (serviceAccountPath) {
        const resolvedPath = path.isAbsolute(serviceAccountPath)
          ? serviceAccountPath
          : path.resolve(process.cwd(), serviceAccountPath);
        const serviceAccount = require(resolvedPath) as ServiceAccount;
        this.firebaseApp = admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
        });
      } else if (projectId) {
        const serviceAccount: ServiceAccount = {
          projectId: this.configService.get<string>("FIREBASE_PROJECT_ID"),
          clientEmail: this.configService.get<string>("FIREBASE_CLIENT_EMAIL"),
          privateKey: this.configService
            .get<string>("FIREBASE_PRIVATE_KEY")
            ?.replace(/\\n/g, "\n"),
        };

        this.firebaseApp = admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
        });
      } else {
        this.logger.warn(
          "Firebase credentials not configured. FCM notifications will be disabled.",
        );
      }

      if (this.firebaseApp) {
        this.logger.log("Firebase Admin SDK initialized successfully");
      }
    } catch (error) {
      this.logger.error("Failed to initialize Firebase Admin SDK", error);
    }
  }

  private ensureInitialized() {
    if (!this.firebaseApp) {
      throw new NotificationDeliveryError("Firebase not initialized", {
        code: "firebase/not-initialized",
        retryable: false,
      });
    }
  }

  private buildMulticastResult(
    tokens: string[],
    response: admin.messaging.BatchResponse,
  ) {
    const invalidTokens: string[] = [];
    let retryableFailureCount = 0;
    const retryableTokens: string[] = [];
    let nonRetryableFailureCount = 0;

    response.responses.forEach((result, index) => {
      if (!result.success && result.error) {
        const classification = this.classifyMessagingError(result.error);

        if (classification.invalidToken) {
          invalidTokens.push(tokens[index]);
          return;
        }

        if (classification.retryable) {
          retryableFailureCount += 1;
          retryableTokens.push(tokens[index]);
          return;
        }

        nonRetryableFailureCount += 1;
      }
    });

    return {
      successCount: response.successCount,
      failureCount:
        invalidTokens.length + retryableFailureCount + nonRetryableFailureCount,
      invalidTokens,
      retryableTokens,
    };
  }

  private async sendMulticastWithRetry(
    tokens: string[],
    buildMessage: (tokens: string[]) => admin.messaging.MulticastMessage,
  ) {
    const invalidTokens: string[] = [];
    let successCount = 0;
    let failureCount = 0;
    let pendingTokens = [...tokens];

    for (let attempt = 0; attempt <= this.partialRetryAttempts; attempt += 1) {
      const response = await admin
        .messaging()
        .sendEachForMulticast(buildMessage(pendingTokens));
      const result = this.buildMulticastResult(pendingTokens, response);

      successCount += result.successCount;
      failureCount += result.failureCount - result.retryableTokens.length;
      invalidTokens.push(...result.invalidTokens);

      if (result.retryableTokens.length === 0) {
        return {
          successCount,
          failureCount,
          invalidTokens,
        };
      }

      if (attempt === this.partialRetryAttempts) {
        if (successCount === 0) {
          throw new NotificationDeliveryError(
            `FCM multicast failed for all ${tokens.length} devices`,
            {
              code: "messaging/multicast-retryable-failure",
              retryable: true,
              invalidTokens,
            },
          );
        }

        failureCount += result.retryableTokens.length;
        return {
          successCount,
          failureCount,
          invalidTokens,
        };
      }

      pendingTokens = result.retryableTokens;
      await this.delay((attempt + 1) * 1000);
    }

    return {
      successCount,
      failureCount,
      invalidTokens,
    };
  }

  private classifyMessagingError(error: unknown) {
    const firebaseError = error as MessagingErrorLike | undefined;
    const code = firebaseError?.code ?? firebaseError?.errorInfo?.code;
    const message =
      firebaseError?.message ??
      firebaseError?.errorInfo?.message ??
      "Unknown Firebase messaging error";

    return {
      code,
      message,
      retryable: code ? this.retryableErrorCodes.has(code) : false,
      invalidToken: code ? this.invalidTokenCodes.has(code) : false,
    };
  }

  private createDeliveryError(
    prefix: string,
    classification: {
      code?: string;
      message: string;
      retryable: boolean;
    },
    cause: unknown,
  ) {
    const message = classification.code
      ? `${prefix}: ${classification.code}`
      : `${prefix}: ${classification.message}`;

    this.logger.error(message, cause);

    return new NotificationDeliveryError(message, {
      code: classification.code,
      retryable: classification.retryable,
      cause,
    });
  }

  private delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
