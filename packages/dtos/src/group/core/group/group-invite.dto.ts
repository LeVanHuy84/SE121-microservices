import { GroupResponseDTO } from './get-group.dto';

export class InvitedGroupDTO extends GroupResponseDTO {
  inviterNames: string[];
}
