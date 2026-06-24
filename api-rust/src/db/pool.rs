use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;

pub async fn create_pool(database_url: &str) -> anyhow::Result<PgPool> {
    Ok(PgPoolOptions::new()
        .max_connections(20)
        .idle_timeout(std::time::Duration::from_secs(30))
        .connect(database_url)
        .await?)
}
