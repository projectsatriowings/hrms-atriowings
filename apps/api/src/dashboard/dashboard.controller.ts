import { Controller, Get } from "@nestjs/common";
import { DashboardService } from "./dashboard.service";
import { CurrentUser, RequestUser } from "../common/decorators";

@Controller("dashboard")
export class DashboardController {
  constructor(private dashboard: DashboardService) {}

  @Get()
  get(@CurrentUser() user: RequestUser) {
    return this.dashboard.get(user);
  }
}
