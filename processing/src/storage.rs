use crate::AppConfig;
use anyhow::{Context, Result};
use s3::Bucket;
use s3::creds::Credentials;
use s3::region::Region;
use tracing::info;

pub struct MinioClient {
    bucket: Bucket,
}

impl MinioClient {
    pub async fn new(config: &AppConfig) -> Result<Self> {
        let region = Region::Custom {
            region: config.minio_region.clone(),
            endpoint: config.minio_endpoint.clone(),
        };

        let credentials = Credentials::new(
            Some(&config.minio_access_key),
            Some(&config.minio_secret_key),
            None,
            None,
            None,
        )?;

        let bucket = *Bucket::new("obs-processed", region.clone(), credentials.clone())?
            .with_path_style();

        if !bucket.exists().await? {
            let bucket_config = s3::BucketConfiguration::default();
            Bucket::create("obs-processed", region, credentials, bucket_config).await?;
            info!("Created bucket: obs-processed");
        }

        info!("MinIO client connected to {}", config.minio_endpoint);
        Ok(Self { bucket })
    }

    pub async fn put(&self, key: &str, data: &[u8]) -> Result<()> {
        self.bucket
            .put_object(key, data)
            .await
            .with_context(|| format!("Failed to put object: {}", key))?;
        Ok(())
    }

    pub async fn get(&self, key: &str) -> Result<Vec<u8>> {
        let data = self
            .bucket
            .get_object(key)
            .await
            .with_context(|| format!("Failed to get object: {}", key))?;
        Ok(data.to_vec())
    }

    pub async fn exists(&self, key: &str) -> Result<bool> {
        Ok(self.bucket.head_object(key).await.is_ok())
    }
}
