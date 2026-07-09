// The platform transaction helper (ADR-005): multi-document consistency uses
// MongoDB transactions — never sequential writes with manual "rollback".
import mongoose, { type ClientSession } from 'mongoose';

export const unitOfWork = async <T>(fn: (session: ClientSession) => Promise<T>): Promise<T> => {
  const session = await mongoose.startSession();
  try {
    let result: T | undefined;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    // withTransaction resolved → fn ran at least once and assigned result.
    return result as T;
  } finally {
    await session.endSession();
  }
};
