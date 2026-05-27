import SMB2 from "@marsaud/smb2";
import { Readable } from "node:stream";

export interface SmbConfig {
  host: string;
  port?: number;
  username?: string;
  password?: string;
  shareName: string;
}

export function getSmbClient(config: SmbConfig): SMB2 {
  return new SMB2({
    share: `\\\\${config.host}\\${config.shareName}`,
    username: config.username || undefined,
    password: config.password || undefined,
    port: config.port || 445,
    autoCloseTimeout: 0 // Keep connection open during operations
  });
}

export async function testSmbConnection(config: SmbConfig): Promise<void> {
  const client = getSmbClient(config) as any;
  try {
    await new Promise<void>((resolve, reject) => {
      client.readdir("", (err: any) => {
        if (err) reject(err);
        else resolve();
      });
    });
  } finally {
    try {
      client.close();
    } catch {}
  }
}

export function smbExists(client: any, path: string): Promise<boolean> {
  const cleanPath = path.replace(/\//g, "\\");
  return new Promise((resolve) => {
    client.exists(cleanPath, (err: any, exists: boolean) => {
      if (err) resolve(false);
      else resolve(exists);
    });
  });
}

export function smbReaddir(client: any, path: string): Promise<any[]> {
  const cleanPath = path.replace(/\//g, "\\");
  return new Promise((resolve, reject) => {
    client.readdir(cleanPath, { stats: true }, (err: any, files: any[]) => {
      if (err) reject(err);
      else resolve(files || []);
    });
  });
}

export function smbReadFile(client: any, path: string): Promise<Buffer> {
  const cleanPath = path.replace(/\//g, "\\");
  return new Promise((resolve, reject) => {
    client.readFile(cleanPath, (err: any, data: Buffer) => {
      if (err) reject(err);
      else resolve(data);
    });
  });
}

export function smbCreateReadStream(
  client: any,
  path: string,
  options?: { start?: number; end?: number }
): Promise<Readable> {
  const cleanPath = path.replace(/\//g, "\\");
  return new Promise((resolve, reject) => {
    client.createReadStream(cleanPath, options, (err: any, stream: Readable) => {
      if (err) reject(err);
      else resolve(stream);
    });
  });
}

export async function* walkSmb(
  client: any,
  basePath: string
): AsyncGenerator<{ path: string; size: number }> {
  const cleanPath = basePath.replace(/\//g, "\\");
  const files = await smbReaddir(client, cleanPath);
  for (const file of files) {
    if (file.name.startsWith(".") || file.name === "node_modules") continue;
    const entryPath = basePath ? `${basePath}/${file.name}` : file.name;
    if (typeof file.isDirectory === "function" && file.isDirectory()) {
      yield* walkSmb(client, entryPath);
    } else if (file.isDirectory === true) {
      yield* walkSmb(client, entryPath);
    } else {
      yield { path: entryPath, size: file.size || 0 };
    }
  }
}
