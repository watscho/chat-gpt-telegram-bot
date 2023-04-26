import path, { dirname } from 'path'
import { unlink } from 'fs/promises'
import installer from '@ffmpeg-installer/ffmpeg'
import ffmpeg from 'fluent-ffmpeg'

export class OggConverter {
  private directory: string

  private mp3Path: string

  public constructor(readonly filepath: string) {
    ffmpeg.setFfmpegPath(installer.path)

    this.setDirectory()
  }

  public toMp3(filename: string): Promise<string> | undefined {
    return new Promise(resolve => {
      this.mp3Path = path.resolve(this.directory, `${filename}.mp3`)

      ffmpeg(this.filepath)
        .inputOption('-t 30')
        .output(this.mp3Path)
        .on('end', () => resolve(this.mp3Path))
        .run()
    })
  }

  public async delete(): Promise<void> {
    await unlink(this.mp3Path)
  }

  private setDirectory() {
    this.directory = path.resolve(dirname(this.filepath))
  }
}
