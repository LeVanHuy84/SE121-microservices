import { Module, OnModuleInit } from '@nestjs/common';
import { UserService } from '../user.service';
import { UserModule } from '../user.module';

@Module({
  imports: [UserModule],
})
export class CommandModule implements OnModuleInit {
  constructor(private readonly userService: UserService) {}

  async onModuleInit() {
    console.log('🏁 Running startup command...');

    await this.userService.create({
      id: 'test-123',
      email: 'test@example.com',
      firstName: 'Test',
      lastName: 'User',
    });

    console.log('✅ Done');

    process.exit(0); // thoát app sau khi chạy xong
  }
}
