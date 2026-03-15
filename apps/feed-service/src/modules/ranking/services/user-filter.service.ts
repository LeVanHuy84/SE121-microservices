import { Injectable } from '@nestjs/common';
import { RankingCandidate } from '../interfaces/ranking-strategy.interface';

/**
 * Service filter candidates for optional hard business rules.
 * Explicit avoided/preferred emotions are no longer available.
 */
@Injectable()
export class UserFilterService {
  /**
   * Keep pass-through behavior for backwards compatibility.
   */
  filterByPreference(
    candidates: RankingCandidate[],
    _preference?: unknown,
  ): RankingCandidate[] {
    return candidates;
  }

  /**
   * Legacy no-op helper kept for API compatibility.
   */
  shouldBoostCandidate(
    _candidate: RankingCandidate,
    _preference?: unknown,
  ): boolean {
    return false;
  }
}
