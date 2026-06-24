use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
pub enum Role {
    Viewer = 1,
    Analyst = 2,
    Operator = 3,
    Admin = 4,
}

impl Role {
    pub fn from_str(s: &str) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "viewer" => Some(Role::Viewer),
            "analyst" => Some(Role::Analyst),
            "operator" => Some(Role::Operator),
            "admin" => Some(Role::Admin),
            _ => None,
        }
    }

    pub fn level(&self) -> i32 {
        match self {
            Role::Viewer => 1,
            Role::Analyst => 2,
            Role::Operator => 3,
            Role::Admin => 4,
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    pub sub: String,
    pub roles: Vec<String>,
    pub exp: usize,
}

#[derive(Clone)]
pub struct AuthService {
    secret: String,
    pub users: Vec<(String, String, Vec<String>)>,
}

impl AuthService {
    pub fn new(config: &crate::config::Config) -> Self {
        Self {
            secret: config.jwt_secret.clone(),
            users: vec![
                ("admin".into(), config.admin_password.clone(), vec!["admin".into()]),
                ("analyst".into(), config.analyst_password.clone(), vec!["analyst".into()]),
                ("operator".into(), config.operator_password.clone(), vec!["operator".into()]),
                ("viewer".into(), config.viewer_password.clone(), vec!["viewer".into()]),
            ],
        }
    }

    pub fn authenticate(&self, username: &str, password: &str) -> Option<String> {
        for (u, p, roles) in &self.users {
            if u == username && p == password {
                let claims = Claims {
                    sub: username.to_string(),
                    roles: roles.clone(),
                    exp: (chrono::Utc::now().timestamp() + 3600) as usize,
                };
                return encode(
                    &Header::default(),
                    &claims,
                    &EncodingKey::from_secret(self.secret.as_bytes()),
                )
                .ok();
            }
        }
        None
    }

    pub fn validate_token(&self, token: &str) -> Option<Claims> {
        decode::<Claims>(
            token,
            &DecodingKey::from_secret(self.secret.as_bytes()),
            &Validation::default(),
        )
        .ok()
        .map(|d| d.claims)
    }

    pub fn authorize(&self, claims: &Claims, required_role: &Role) -> bool {
        for role_str in &claims.roles {
            if let Some(role) = Role::from_str(role_str) {
                if role.level() >= required_role.level() {
                    return true;
                }
            }
        }
        false
    }
}
