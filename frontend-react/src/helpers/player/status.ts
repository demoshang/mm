import { PlayerBase } from './base';
import { Status } from './interface';

export class PlayerStatus extends PlayerBase {
  // ε½εηΆζ
  public status = Status.paused;

  public get isPaused() {
    return this.status === Status.paused;
  }
}
