import { CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  QueryList,
  ViewChildren,
  Input,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { untilDestroyed } from 'ngx-take-until-destroy';
import { merge } from 'rxjs';
import { debounceTime, filter, map, pairwise, startWith, switchMap, tap } from 'rxjs/operators';

import { Privilege } from '../../../core/apollo/graphql';
import { PlayerSong } from '../../../core/audio/interface';
import { TEMP_PLAYLIST_ID } from '../../../core/player/constants';
import { PersistService, Playlist } from '../../../core/services/persist.service';
import { PlayerService } from '../../../core/services/player.service';
import { PlaylistService } from '../../../core/services/playlist.service';
import { SidenavService } from '../../../core/services/sidenav.service';

@Component({
  selector: 'app-song-list',
  templateUrl: './song-list.component.html',
  styleUrls: ['./song-list.component.scss'],
})
export class SongListComponent implements OnInit, AfterViewInit, OnDestroy {
  public Privilege = Privilege;

  public playlist: Playlist = {
    id: TEMP_PLAYLIST_ID,
    name: TEMP_PLAYLIST_ID,
    songs: [],
  };

  @Input()
  private playlistId: string | null = null;

  @ViewChildren('perSong')
  private songQueryList!: QueryList<ElementRef<HTMLDivElement>>;

  constructor(
    private readonly playerService: PlayerService,
    private readonly playlistService: PlaylistService,
    private readonly persistService: PersistService,
    private readonly activatedRoute: ActivatedRoute,
    private readonly sidenavService: SidenavService
  ) {}

  public ngOnInit() {
    this.queryParams().subscribe(() => {
      console.info('this.playlist: ', this.playlist);
    }, console.warn);
  }

  public ngOnDestroy() {}

  public ngAfterViewInit() {
    this.getLocateSource().subscribe(
      () => {},
      (e) => {
        console.warn('ngAfterViewInit Locate e', e);
      }
    );

    this.playerService.locate$.next();
  }

  public get currentSong() {
    return this.playerService.currentSong;
  }

  public play(song: PlayerSong, index: number) {
    console.info(
      'basePlaylistId: ',
      this.playerService.basePlaylistId,
      'current: ',
      this.playlist.id
    );

    // ???????????????????????????
    if (this.playlist.id === TEMP_PLAYLIST_ID) {
      this.playerService.playAt(song);
      return;
    }

    // ????????????????????????playlist
    if (this.playerService.basePlaylistId === this.playlist.id) {
      const i = this.playerService.song2index(song);
      // ??????????????????????????????????????????
      if (i >= 0) {
        this.playerService.playAt(i);

        return;
      }
    }

    // ??????????????????
    this.playerService.loadPlaylist(this.playlist.id, index, true).subscribe(
      () => {},
      (e) => {
        console.warn(e);
      }
    );
  }

  public remove(song: PlayerSong) {
    // ???????????????????????????
    if (this.playlist.id === TEMP_PLAYLIST_ID) {
      this.playerService.remove(song);
    } else {
      this.playlistService
        .removeSong(this.playlist.id, song)
        .pipe(
          map(() => {
            this.playerService.remove(song);
          })
        )
        .subscribe(() => {}, console.warn);
    }
  }

  public formatArtists(artists: { name: string }[]) {
    return this.playerService.formatArtists(artists);
  }

  public drop(event: CdkDragDrop<string[]>) {
    const { currentSong } = this;

    // ???????????????????????????
    if (this.playlist.id === TEMP_PLAYLIST_ID) {
      moveItemInArray(this.playerService.songList, event.previousIndex, event.currentIndex);

      if (currentSong) {
        this.playerService.currentIndex = this.playerService.song2index(currentSong);
        this.playerService.loadNextSongs();
      }
    } else {
      moveItemInArray(this.playlist.songs, event.previousIndex, event.currentIndex);
    }

    this.playlistService.persist(this.playlist.id).subscribe(() => {}, console.warn);
  }

  private queryParams() {
    return this.activatedRoute.queryParams.pipe(
      map((qs) => {
        console.info('input playlistId: ', this.playlistId);

        if (this.playlistId) {
          return this.playlistId;
        }

        if (qs.id) {
          return qs.id;
        }

        return TEMP_PLAYLIST_ID;
      }),
      switchMap((id) => this.persistService.getPlaylist(id)),
      filter((playlist): playlist is Playlist => {
        return !!playlist;
      }),
      tap((playlist) => {
        this.playlist = playlist;

        this.sidenavService.next({ mode: 'side', trigger: 'open' });
      }),
      untilDestroyed(this)
    );
  }

  private getLocateSource() {
    return merge(
      this.songQueryList.changes.pipe(
        startWith(this.songQueryList),
        map((query: QueryList<ElementRef<HTMLDivElement>>) => query.length),
        pairwise(),
        filter(([len1, len2]) => len1 !== len2)
      ),
      this.playerService.locate$
    ).pipe(
      filter(() => {
        if (!this.playlist) {
          return true;
        }

        return (
          this.playlist.id === TEMP_PLAYLIST_ID ||
          this.playerService.basePlaylistId === this.playlist.id
        );
      }),
      debounceTime(200),
      map(() => {
        if (!this.playlist || this.playlist.id === TEMP_PLAYLIST_ID) {
          return this.playerService.currentIndex;
        }

        const { currentSong } = this.playerService;
        if (!currentSong) {
          return this.playerService.currentIndex;
        }

        return this.playlist.songs.findIndex(({ id, provider }) => {
          return currentSong.id === id && currentSong.provider === provider;
        });
      }),
      map((targetIndex) => {
        const elementRef = this.songQueryList.find((_item, index) => index === targetIndex);

        if (elementRef) {
          return elementRef.nativeElement;
        }

        return null;
      }),
      filter((ele): ele is HTMLDivElement => !!ele),
      tap((ele) => {
        ele.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
          inline: 'center',
        });
      }),
      untilDestroyed(this)
    );
  }
}
