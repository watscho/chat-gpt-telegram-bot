import https from 'https'
import path from 'path'
import { createWriteStream, existsSync, mkdirSync } from 'fs'
import { unlink } from 'fs/promises'

export class OggDownloader {
  private directory: string = path.resolve(__dirname, '../../voices')

  private oggPath: string

  public constructor(readonly url: string) {
    this.createDirectoryIfNotExists()
  }

  public download(filename: string): Promise<string> {
    return new Promise(resolve => {
      this.oggPath = path.resolve(this.directory, `${filename}.ogg`)

      const stream$ = createWriteStream(this.oggPath)

      https.get(this.url, response => {
        response.pipe(stream$)

        stream$.on('finish', () => {
          resolve(this.oggPath)
        })
      })
    })
  }

  public async delete(): Promise<void> {
    await unlink(this.oggPath)
  }

  private createDirectoryIfNotExists(): void {
    if (!existsSync(this.directory)) {
      mkdirSync(this.directory, { recursive: true })
    }
  }
}
