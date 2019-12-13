import {
  EMPTY, merge, Observable, of, throwError,
} from 'rxjs';
import {
  catchError,
  delay,
  map,
  mapTo,
  share,
  switchMap,
  takeUntil,
  tap,
  throttleTime,
} from 'rxjs/operators';

import { AudioEvent, PeakSong, PlayerSong } from '../audio/interface';
import { AudioLoadSource } from '../audio/pool-audio';
import { RxAudio } from '../audio/rx-audio';
import { PlayerAction } from './action';
import { Status } from './interface';

export class PlayerPlay extends PlayerAction {
  constructor() {
    super();

    this.songChange$ = merge(
      this.click$.pipe(
        throttleTime(500),
        tap((nu) => {
          console.debug('========> click$', nu);
          // 游标变更
          this.setIndex(nu);

          // 状态变更
          this.status = Status.playing;
        }),
        mapTo('click'),
      ),
      this.end$.pipe(
        throttleTime(500),
        tap((song) => {
          console.debug('====>  this.end$, play next song', song);
          // 游标变更
          this.setIndexStep(1);
        }),
        mapTo('end'),
      ),
      this.error$.pipe(
        tap(() => {
          console.debug('====> this.error$, replay current song');
          this.errorStatus.nu += 1;
          this.errorStatus.continuous += 1;

          // 一直出错, 就直接暂停
          if (this.errorStatus.continuous >= this.config.errorRetry.playerRetries) {
            this.status = Status.paused;
          }

          // 当前歌曲一直出错, 就播放下一首
          if (this.errorStatus.nu >= this.config.errorRetry.songRetries) {
            this.setIndexStep(1);
          }

          console.debug({
            ...this.errorStatus,
            ...this.config.errorRetry,
          });
        }),
        mapTo('error'),
      ),
    ).pipe(
      switchMap((eventName) => {
        console.debug('歌曲变更触发', '触发类型', eventName, '触发歌曲下标', this.currentIndex);
        if (eventName === 'click') {
          return of(null);
        }
        if (eventName === 'end') {
          return of(null).pipe(delay(10));
        }
        if (eventName === 'error') {
          return of(null).pipe(delay(Math.sqrt(this.errorStatus.nu) * 500));
        }
        return of(null);
      }),
      tap(() => {
        if (this.rxAudio) {
          console.debug('停止上一首播放');
          this.rxAudio.pause();
        }

        this.status = Status.loading
      }),
      map(() => this.getSong(this.currentIndex)),
      share(),
    );
  }

  public play() {
    this.status = Status.playing;

    if (this.rxAudio) {
      this.rxAudio.layIn();
    } else {
      this.playAt(this.currentIndex);
    }
  }

  private getSong(index: number): PlayerSong {
    // eslint-disable-next-line no-param-reassign
    index = this.getValidIndex(index);

    if (index < 0) {
      throw new Error('index lower than zero');
    }

    return this.songList[index];
  }

  private songStatus$({ song, rxAudio }: { song: PeakSong; rxAudio: RxAudio }) {
    return merge(
      // 错误
      rxAudio.event(AudioEvent.error).pipe(
        tap(() => {
          console.debug(AudioEvent.error, song);
          this.error$.next();
        }),
      ),
      // 结束
      merge(
        // 正常结束
        rxAudio.event(AudioEvent.ended),
        // layOut 结束
        rxAudio.event(AudioEvent.layoutEnded),
      ).pipe(
        throttleTime(500),
        tap(() => {
          console.debug('ended', song);
          this.end$.next(song);
        }),
      ),
      // 渐出
      rxAudio.event(AudioEvent.layoutTouch).pipe(
        tap(() => {
          rxAudio.layOut();
        }),
      ),
      // 预载入
      rxAudio.event(AudioEvent.played).pipe(
        tap(() => {
          this.loadNextSongs();
        }),
      ),
    );
  }

  protected playSong(
    source$: AudioLoadSource,
  ): Observable<
    | never
    | {
      rxAudio: RxAudio;
      song: PeakSong;
    }
    > {
    return source$.pipe(
      tap(({ song, rxAudio, changed }) => {
        console.debug(`play ┣ ${song.name} ┫ ┣ ${song.provider} ┫`, {
          currentTime: rxAudio.audio.currentTime,
          src: rxAudio.audio.src,
          currentIndex: this.currentIndex,
          status: this.status,
          song,
        });

        if (changed) {
          console.debug('song changed, update song info', song);
          this.updateSongInfo(song);
          this.persistTask$.next(song);
        }

        // 状态变换, 需要做一些操作
        this.songStatus$({ song, rxAudio })
          .pipe(takeUntil(this.songChange$))
          .subscribe(() => {});
      }),
      switchMap(({ song, rxAudio }) => {
        if (!rxAudio) {
          return throwError('no rxAudio');
        }

        // 替换为当前要播放的
        this.rxAudio = rxAudio;

        if (this.status === Status.paused) {
          console.debug('当前状态为停止状态', song);
          return of({ rxAudio, song });
        }

        console.debug('播放新歌', song);
        this.status = Status.playing;
        return rxAudio.layIn(song.peakStartTime).pipe(map(() => ({ song, rxAudio })));
      }),
      catchError((err) => {
        console.warn('load audio error', err);
        if (this.status !== Status.paused) {
          this.error$.next(err);
        }

        return EMPTY;
      }),
      takeUntil(this.songChange$),
    );
  }

  private updateSongInfo(song: PeakSong) {
    // eslint-disable-next-line max-len
    const index = this.songList.findIndex(
      ({ id, provider }) => id === song.id && provider === song.provider,
    );

    if (index >= 0) {
      this.songList.splice(index, 1, song);
    }
  }
}
