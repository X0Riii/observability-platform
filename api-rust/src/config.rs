use std::env;

#[derive(Clone, Debug)]
pub struct Config {
    pub port: u16,
    pub database_url: String,
    pub kafka_brokers: String,
    pub opensearch_url: String,
    pub minio_endpoint: String,
    pub minio_access_key: String,
    pub minio_secret_key: String,
    pub jwt_secret: String,
    pub admin_password: String,
    pub analyst_password: String,
    pub operator_password: String,
    pub viewer_password: String,
}

impl Config {
    pub fn from_env() -> Self {
        Self {
            port: env::var("PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(4000),
            database_url: env::var("DATABASE_URL")
                .unwrap_or_else(|_| "postgres://obs:obspass@127.0.0.1:5432/observability".into()),
            kafka_brokers: env::var("KAFKA_BROKERS").unwrap_or_else(|_| "127.0.0.1:9092".into()),
            opensearch_url: env::var("OPENSEARCH_URL").unwrap_or_else(|_| "http://127.0.0.1:9200".into()),
            minio_endpoint: env::var("MINIO_ENDPOINT").unwrap_or_else(|_| "127.0.0.1:9000".into()),
            minio_access_key: env::var("MINIO_ACCESS_KEY").unwrap_or_else(|_| "minioadmin".into()),
            minio_secret_key: env::var("MINIO_SECRET_KEY").unwrap_or_else(|_| "minioadmin".into()),
            jwt_secret: env::var("JWT_SECRET")
                .unwrap_or_else(|_| "obs-platform-secret-change-in-production".into()),
            admin_password: env::var("ADMIN_PASSWORD").unwrap_or_else(|_| "admin".into()),
            analyst_password: env::var("ANALYST_PASSWORD").unwrap_or_else(|_| "analyst".into()),
            operator_password: env::var("OPERATOR_PASSWORD").unwrap_or_else(|_| "operator".into()),
            viewer_password: env::var("VIEWER_PASSWORD").unwrap_or_else(|_| "viewer".into()),
        }
    }
}
