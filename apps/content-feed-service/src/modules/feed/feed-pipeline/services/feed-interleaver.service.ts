import { Injectable, Logger } from "@nestjs/common";
import { InjectRedis } from "@nestjs-modules/ioredis";
import Redis from "ioredis";
import { FeedEventType, FeedItemDTO, InterventionType } from "@repo/dtos";
import { EmotionFeatureService } from "../../ranking/services/emotion-feature.service";

@Injectable()
export class FeedInterleaverService {
  private readonly logger = new Logger(FeedInterleaverService.name);
  public static readonly COOLDOWN_TTL = 43200; // 12 hours in seconds
  public static readonly INTERVENTION_SLOT = 4; // index 4 -> 5th item in feed

  constructor(
    @InjectRedis() private readonly redis: Redis,
    private readonly emotionService: EmotionFeatureService,
  ) {}

  /**
   * Tự động kiểm tra điều kiện và chèn Thẻ Safe Space vào Bảng tin:
   * 1. Chỉ áp dụng cho Trang 1 (offset === 0)
   * 2. Chỉ hiển thị khi chỉ số suy sụp tâm lý Distress > 0.5 (dùng lại distress từ pipeline)
   * 3. Kiểm tra Redis Cooldown TTL 12h để tránh làm phiền người dùng
   * 4. Ưu tiên chèn tại slot 5 (index 4); nếu feed có ít hơn 5 bài thì chèn vào cuối feed
   */
  async maybeInterleaveSafeSpaceCard(
    userId: string,
    feedDTOs: FeedItemDTO[],
    offset: number,
    distressInput?: number,
    limit?: number,
  ): Promise<FeedItemDTO[]> {
    // 1. Chỉ áp dụng cho Trang 1
    if (offset !== 0 || !feedDTOs || feedDTOs.length === 0) {
      return feedDTOs;
    }

    // 2. Không chèn thẻ khi client yêu cầu batch quá nhỏ (như test case so sánh limit < 5)
    if (limit !== undefined && limit < 5) {
      return feedDTOs;
    }

    // 3. Sử dụng distress truyền trực tiếp từ pipeline để tránh gọi RPC lặp lại
    let distress = distressInput;
    if (distress === undefined) {
      const emotionFeatures =
        await this.emotionService.getEmotionFeatures(userId);
      distress = this.emotionService.calcDistress(emotionFeatures);
    }

    if (distress <= 0.5) {
      return feedDTOs;
    }

    // 4. Kiểm tra tần suất hiển thị qua Redis Cooldown Key
    const cooldownKey = `feed:intervention:cooldown:${userId}`;
    const isCoolingDown = await this.redis.get(cooldownKey);
    if (isCoolingDown) {
      this.logger.debug(
        `[INTERVENTION COOLDOWN ACTIVE] Safe space card suppressed for user=${userId}`,
      );
      return feedDTOs;
    }

    // 5. Khởi tạo Thẻ Safe Space Card nhẹ nhàng, không phán xét
    const interventionItem: FeedItemDTO = {
      id: `intervention-${userId}-${Date.now()}`,
      type: FeedEventType.INTERVENTION,
      intervention: {
        id: `card-safespace-${userId}`,
        type: InterventionType.AI_CHATBOT_SAFE_SPACE,
        title: "Góc nhỏ lắng nghe",
        description:
          "Hôm nay của bạn thế nào? Một ngày dài trôi qua bạn đã vất vả rồi. Nếu có điều gì muốn trải lòng hay chia sẻ, góc nhỏ AI luôn ở đây để đồng hành cùng bạn nhé.",
        buttonText: "Trò chuyện cùng Trợ lý AI",
      },
    };

    // 6. Vị trí chèn: Ưu tiên slot 5 (index 4); nếu feed có ít hơn 5 bài thì đặt ở cuối feed
    const insertIndex = Math.min(
      FeedInterleaverService.INTERVENTION_SLOT,
      feedDTOs.length,
    );
    const result = [...feedDTOs];
    result.splice(insertIndex, 0, interventionItem);

    // 7. Kích hoạt Cooldown 12 giờ trên Redis
    await this.redis.set(
      cooldownKey,
      "1",
      "EX",
      FeedInterleaverService.COOLDOWN_TTL,
    );
    this.logger.log(
      `[SAFE SPACE INTERLEAVED] Inserted Safe Space card at index ${insertIndex} for user=${userId} distress=${distress}`,
    );

    return result;
  }
}
