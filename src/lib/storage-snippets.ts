import type { Permission } from './storage-access';

/** The injected secret names a snippet reads; matches `ObjectStorageComputeBindingSecretKeys`. */
export interface EnvNames {
  endpoint: string;
  region: string;
  bucket: string;
  access_key_id: string;
  secret_access_key: string;
  addressing_style: string;
}

/**
 * Minimal client code that reads a binding's injected variables. A write-only
 * binding gets an upload example, since a read would be refused.
 */
export function nodeSnippet(env: EnvNames, permission: Permission): string {
  const write = permission === 'write';
  const command = write ? 'PutObjectCommand' : 'GetObjectCommand';
  return `import { S3Client, ${command} } from '@aws-sdk/client-s3';

const s3 = new S3Client({
  endpoint: process.env.${env.endpoint},
  region: process.env.${env.region},
  forcePathStyle: process.env.${env.addressing_style} === 'path',
  credentials: {
    accessKeyId: process.env.${env.access_key_id},
    secretAccessKey: process.env.${env.secret_access_key},
  },
});

${
  write
    ? `await s3.send(
  new PutObjectCommand({ Bucket: process.env.${env.bucket}, Key: 'hello.txt', Body: 'hi' })
);`
    : `const object = await s3.send(
  new GetObjectCommand({ Bucket: process.env.${env.bucket}, Key: 'hello.txt' })
);`
}`;
}

export function pythonSnippet(env: EnvNames, permission: Permission): string {
  const write = permission === 'write';
  return `import os
import boto3
from botocore.config import Config

s3 = boto3.client(
    "s3",
    endpoint_url=os.environ["${env.endpoint}"],
    region_name=os.environ["${env.region}"],
    aws_access_key_id=os.environ["${env.access_key_id}"],
    aws_secret_access_key=os.environ["${env.secret_access_key}"],
    config=Config(s3={"addressing_style": os.environ["${env.addressing_style}"]}),
)

${
  write
    ? `s3.put_object(Bucket=os.environ["${env.bucket}"], Key="hello.txt", Body=b"hi")`
    : `body = s3.get_object(Bucket=os.environ["${env.bucket}"], Key="hello.txt")["Body"].read()`
}`;
}
