import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
	EmotionAnalyticsSnapshot,
	EmotionAnalyticsSnapshotSchema,
} from 'src/mongo/schema/analytic-snapshot.schema';
import {
	UserEmotionProfile,
	UserEmotionProfileSchema,
} from 'src/mongo/schema/emotion-profile.schema';
import { EmotionFeatureController } from './emotion-feature/emotion-feature.controller';
import { EmotionFeatureRepository } from './emotion-feature/emotion-feature.repository';
import { EmotionFeatureService } from './emotion-feature/emotion-feature.service';

@Module({
	imports: [
		MongooseModule.forFeature([
			{
				name: UserEmotionProfile.name,
				schema: UserEmotionProfileSchema,
			},
			{
				name: EmotionAnalyticsSnapshot.name,
				schema: EmotionAnalyticsSnapshotSchema,
			},
		]),
	],
	controllers: [EmotionFeatureController],
	providers: [EmotionFeatureRepository, EmotionFeatureService],
})
export class InsightModule {}
