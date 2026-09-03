//! Crate-wide error type shared by every `#[tauri::command]`.
//!
//! The frontend only ever sees `error.message` / `String(error)`, so the error
//! serialises as its `Display` string to keep the invoke contract unchanged.

use serde::{Serialize, Serializer};

#[derive(Debug, thiserror::Error)]
pub enum AmplyError {
    #[error("{0}")]
    Io(#[from] std::io::Error),
    #[error("database: {0}")]
    Db(#[from] rusqlite::Error),
    #[error("network: {0}")]
    Http(#[from] reqwest::Error),
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
    #[error("audio: {0}")]
    Audio(String),
    #[error("{0}")]
    Forbidden(String),
    #[error("{0}")]
    InvalidInput(String),
    #[error("{0}")]
    Unavailable(String),
    #[error("{0}")]
    Other(String),
}

impl From<String> for AmplyError {
    fn from(message: String) -> Self {
        AmplyError::Other(message)
    }
}

impl From<&str> for AmplyError {
    fn from(message: &str) -> Self {
        AmplyError::Other(message.to_string())
    }
}

impl Serialize for AmplyError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

pub type AmplyResult<T> = Result<T, AmplyError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serialises_as_plain_display_string() {
        let forbidden = AmplyError::Forbidden("nope".to_string());
        assert_eq!(serde_json::to_string(&forbidden).unwrap(), "\"nope\"");

        let other: AmplyError = "plain".into();
        assert_eq!(serde_json::to_string(&other).unwrap(), "\"plain\"");

        let json_err = serde_json::from_str::<u32>("x").unwrap_err();
        let wrapped: AmplyError = json_err.into();
        assert!(serde_json::to_string(&wrapped).unwrap().starts_with("\"json: "));
    }
}
