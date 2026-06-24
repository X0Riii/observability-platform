use anyhow::Result;
use s3::{Auth, Client, Credentials, Region};

#[derive(Clone)]
pub struct MinioClient {
    client: Client,
}

impl MinioClient {
    pub fn new(config: &crate::config::Config) -> Self {
        let endpoint = format!("http://{}", config.minio_endpoint);
        let credentials = Credentials::new(
            &config.minio_access_key,
            &config.minio_secret_key,
        ).expect("Invalid MinIO credentials");
        let auth = Auth::Static(credentials);
        let region = Region::new("us-east-1").expect("Invalid region");
        let client = Client::builder(&endpoint)
            .expect("Failed to create S3 client builder")
            .region(region.to_string())
            .auth(auth)
            .build()
            .expect("Failed to build S3 client");
        Self { client }
    }

    pub async fn ensure_bucket(&self, bucket_name: &str) -> Result<()> {
        let exists = self.client
            .buckets()
            .head(bucket_name)
            .send()
            .await;
        match exists {
            Ok(_) => {}
            Err(e) => {
                if let s3::Error::Api { status, .. } = &e {
                    if *status == 404 {
                        self.client.buckets().create(bucket_name).send().await?;
                        tracing::info!("Created bucket: {}", bucket_name);
                    } else {
                        tracing::info!("Bucket {} head error: {}", bucket_name, e);
                    }
                } else {
                    tracing::info!("Bucket {} check error: {}", bucket_name, e);
                }
            }
        }
        Ok(())
    }

    pub async fn get_object(&self, bucket: &str, key: &str) -> Result<Vec<u8>> {
        let output = self.client
            .objects()
            .get(bucket, key)
            .send()
            .await?;
        use tokio_stream::StreamExt;
        let mut body = output.body;
        let mut data = Vec::new();
        while let Some(chunk) = body.next().await {
            data.extend_from_slice(&chunk?);
        }
        Ok(data)
    }

    pub async fn put_object(&self, bucket: &str, key: &str, data: &[u8], content_type: &str) -> Result<()> {
        self.client
            .objects()
            .put(bucket, key)
            .content_type(content_type)?
            .body_bytes(data.to_vec())
            .send()
            .await?;
        Ok(())
    }
}
