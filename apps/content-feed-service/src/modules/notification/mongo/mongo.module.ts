import { Global, Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";

@Global()
@Module({
  imports: [MongooseModule],
  exports: [MongooseModule],
})
export class NotificationMongoModule {}
