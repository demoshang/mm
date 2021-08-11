import { Observable, Subscription } from 'rxjs';
import { map, shareReplay, tap, takeUntil } from 'rxjs/operators';

import { PeakConfig, PeakSong, PlayerSong, Setting } from './interface';
import { RxAudio } from './rx-audio';

export type AudioLoadSource = Observable<{
  song: PeakSong;
  changed: boolean;
  rxAudio: RxAudio;
}>;

interface PoolItem {
  source$: AudioLoadSource;
  subscription: Subscription;
  rxAudio: RxAudio;
  peakConfig: PeakConfig;
}

export class PoolAudio {
  public static getSongKey({ id, provider }: Pick<PlayerSong, 'id' | 'provider'>) {
    return `${id}|${provider}`;
  }

  // 已用池
  private pool: {
    [key: string]: PoolItem;
  } = {};

  // 可用池
  private restList: RxAudio[] = [];

  public maintain({
    list,
    peakConfig,
  }: {
    list: {
      song: PlayerSong;
      preload$: Observable<{
        song: PeakSong;
        changed: boolean;
      }>;
    }[];
    peakConfig: PeakConfig;
  }) {
    const poolKeys = Object.keys(this.pool);

    const restKeys = poolKeys.filter(
      (poolKey) => !list.some(({ song }) => PoolAudio.getSongKey(song) === poolKey)
    );

    // 删除用不到的
    restKeys.forEach((key) => {
      this.release(key);
    });

    // build现在需要的
    list.forEach(({ song, preload$ }) => {
      this.getSong(
        {
          song,
          peakConfig,
        },
        preload$
      );
    });
  }

  public getSong(
    setting: Setting,
    preload$: Observable<{
      song: PeakSong;
      changed: boolean;
    }>
  ): PoolItem {
    const { song, peakConfig } = setting;
    if (!this.checkInPool(song, peakConfig)) {
      this.createPoolItem(setting, preload$);
    }

    return this.getPoolItem(song);
  }

  private getPoolItem(song: PlayerSong): PoolItem {
    return this.pool[PoolAudio.getSongKey(song)];
  }

  private checkInPool(song: PlayerSong, peakConfig: PeakConfig): boolean {
    const item = this.getPoolItem(song);

    if (!item) {
      return false;
    }

    // 还在播放中
    if (item.rxAudio && !item.rxAudio.audio.paused) {
      return true;
    }

    if (item.peakConfig.duration !== peakConfig.duration) {
      console.info('peakConfig change, rebuild');
      this.release(PoolAudio.getSongKey(song));
      return false;
    }

    return true;
  }

  private release(songKey: string): void {
    const poolItem = this.pool[songKey];
    if (!poolItem) {
      return;
    }

    const { subscription, rxAudio } = poolItem;
    rxAudio.release();

    // unsubscribe
    subscription.unsubscribe();

    delete this.pool[songKey];
    this.restList.push(rxAudio);
  }

  private createPoolItem(
    setting: Setting,
    preload$: Observable<{
      song: PeakSong;
      changed: boolean;
    }>
  ): void {
    const { song, peakConfig } = setting;

    let rxAudio: RxAudio;
    if (this.restList.length) {
      rxAudio = this.restList.pop() as RxAudio;
    } else {
      rxAudio = new RxAudio(peakConfig);
    }

    const source$ = preload$.pipe(
      tap(({ song: peakSong }) => {
        rxAudio.set({
          song: peakSong,
          currentTime: peakSong.peakStartTime,
          peakConfig,
        });
      }),
      map((data) => ({ ...data, rxAudio })),
      shareReplay({
        bufferSize: 1,
        refCount: true,
      }),
      takeUntil(rxAudio.release$)
    );

    this.pool[PoolAudio.getSongKey(song)] = {
      // 先subscribe 执行起来
      subscription: source$.subscribe(({ song: peakSong }) => {
        console.debug(`预载入 ┣ ${peakSong.name} ┫ 成功`, peakSong);
      }, console.warn),
      source$,
      peakConfig: {
        ...peakConfig,
      },
      rxAudio,
    };
  }
}
