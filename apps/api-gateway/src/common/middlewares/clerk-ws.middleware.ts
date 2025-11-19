
import * as cookie from 'cookie';
import { Logger } from '@nestjs/common';
import { verifyToken } from '@clerk/backend';

const logger = new Logger('ClerkWsMiddleware');

export const clerkWsMiddleware = async (socket, next) => {
  
  try {
    // ✅ 1️⃣ Lấy token từ handshake.auth (browser gửi được)
    const authToken = socket.handshake?.headers?.token;

 
    const token = authToken;
    if (!token) {
      logger.warn('❌ No token found in handshake (auth)');
      return next(new Error('Unauthorized'));
    }

    // 3️⃣ Verify token qua Clerk SDK
    const session = await verifyToken(token, {
      secretKey: process.env.CLERK_SECRET_KEY,
    });

    // guard against undefined session or missing subject to avoid "possibly undefined" errors
    if (!session || !session.sub) {
      logger.warn('❌ Clerk verification returned no session or missing subject');
      return next(new Error('Unauthorized'));
    }

    socket.user = { id: session.sub };
    logger.log(`✅ Authenticated user ${session.sub}`);
    next();
  } catch (err) {
    logger.error('❌ Clerk verification failed', err);
    next(new Error('Unauthorized'));
  }
};
