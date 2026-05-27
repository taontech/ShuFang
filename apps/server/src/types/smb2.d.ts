declare module '@marsaud/smb2' {
  import { Readable } from 'node:stream';

  interface SMB2Options {
    share: string;
    username?: string;
    password?: string;
    port?: number;
    domain?: string;
    autoCloseTimeout?: number;
  }

  class SMB2 {
    constructor(options: SMB2Options);
    readdir(path: string): Promise<string[]>;
    readFile(path: string): Promise<Buffer>;
    exists(path: string): Promise<boolean>;
    createReadStream(path: string, options?: { start?: number; end?: number; autoClose?: boolean }): Promise<Readable>;
    close(): void;
  }

  export default SMB2;
}
