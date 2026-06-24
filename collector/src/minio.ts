import * as Minio from 'minio';
import { Readable } from 'stream';
import { compress } from '@mongodb-js/zstd';

export class MinioClient {
  private client: Minio.Client;
  private bucketCache = new Set<string>();

  constructor(endpoint: string, port: number, accessKey: string, secretKey: string, useSSL = false) {
    this.client = new Minio.Client({ endPoint: endpoint, port, useSSL, accessKey, secretKey });
  }

  private async ensureBucket(bucketName: string): Promise<void> {
    if (this.bucketCache.has(bucketName)) return;
    try {
      const exists = await this.client.bucketExists(bucketName);
      if (!exists) {
        await this.client.makeBucket(bucketName, 'us-east-1');
        console.log(`[MinIO] Bucket ${bucketName} created`);
      }
    } catch (err: any) {
      if (err.code === 'BucketAlreadyOwnedByYou') {
        console.log(`[MinIO] Bucket ${bucketName} already exists`);
      } else {
        throw err;
      }
    }
    this.bucketCache.add(bucketName);
  }

  async uploadBuffer(bucketName: string, objectName: string, buffer: Buffer, contentType: string = 'application/octet-stream', compress_zst = false): Promise<string> {
    await this.ensureBucket(bucketName);
    const finalBuffer = compress_zst ? await compress(buffer, 3) : buffer;
    const finalName = compress_zst ? `${objectName}.zst` : objectName;
    await this.client.putObject(bucketName, finalName, finalBuffer, finalBuffer.length, {
      'Content-Type': compress_zst ? 'application/zstd' : contentType,
    });
    console.log(`[MinIO] Uploaded ${finalName} to ${bucketName} (${finalBuffer.length} bytes)`);
    return finalName;
  }

  async uploadStream(bucketName: string, objectName: string, stream: Readable, size: number, contentType: string = 'application/octet-stream'): Promise<void> {
    await this.ensureBucket(bucketName);
    await this.client.putObject(bucketName, objectName, stream, size, { 'Content-Type': contentType });
    console.log(`[MinIO] Uploaded ${objectName} to ${bucketName} via stream`);
  }
}
