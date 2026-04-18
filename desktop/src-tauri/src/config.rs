use std::fs;
use std::io::{self, Write};
use std::os::fd::AsRawFd;
use std::os::unix::fs::OpenOptionsExt;
use std::path::PathBuf;

use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};

/// Mirror of the CLI's `~/.config/codeburn/config.json` format. Only fields we touch are
/// modelled; foreign keys round-trip untouched through `serde_json::Value` so we never
/// clobber settings we don't understand.
#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct CurrencyConfig {
    #[serde(default, flatten)]
    extra: serde_json::Map<String, serde_json::Value>,
}

fn codeburn_config_dir() -> PathBuf {
    dirs::home_dir()
        .map(|h| h.join(".config/codeburn"))
        .unwrap_or_else(|| PathBuf::from(".codeburn"))
}

fn config_path() -> PathBuf {
    codeburn_config_dir().join("config.json")
}

fn lock_path() -> PathBuf {
    codeburn_config_dir().join(".config.lock")
}

impl CurrencyConfig {
    pub fn load_or_default() -> Self {
        match fs::read(config_path()) {
            Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or_default(),
            Err(_) => Self::default(),
        }
    }

    /// Atomic read-modify-write under an on-disk flock so a concurrent `codeburn currency`
    /// from a terminal can't race us. Same pattern as the Swift `SafeFile.withExclusiveLock`
    /// used by the macOS app so the two clients never lose each other's edits.
    pub fn set_currency(&mut self, code: &str, symbol: &str) -> Result<()> {
        fs::create_dir_all(codeburn_config_dir())
            .with_context(|| "failed to create ~/.config/codeburn")?;

        let lock = fs::OpenOptions::new()
            .create(true)
            .read(true)
            .write(true)
            .mode(0o600)
            .open(lock_path())
            .with_context(|| "failed to open config lock")?;

        let fd = lock.as_raw_fd();
        let ret = unsafe { libc_flock(fd, LOCK_EX) };
        if ret != 0 {
            return Err(anyhow!("flock failed: {}", io::Error::last_os_error()));
        }

        // Re-read under the lock so we don't clobber writes that landed between our initial
        // load and now.
        let mut disk: serde_json::Value = match fs::read(config_path()) {
            Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or_else(|_| serde_json::json!({})),
            Err(_) => serde_json::json!({}),
        };

        if code == "USD" {
            if let Some(obj) = disk.as_object_mut() {
                obj.remove("currency");
            }
        } else if let Some(obj) = disk.as_object_mut() {
            obj.insert(
                "currency".into(),
                serde_json::json!({ "code": code, "symbol": symbol }),
            );
        }

        let serialized = serde_json::to_vec_pretty(&disk)?;
        let tmp = config_path().with_extension("tmp");
        {
            let mut file = fs::OpenOptions::new()
                .create(true)
                .write(true)
                .truncate(true)
                .mode(0o600)
                .open(&tmp)?;
            file.write_all(&serialized)?;
            file.flush()?;
        }
        fs::rename(&tmp, config_path())?;

        let _ = unsafe { libc_flock(fd, LOCK_UN) };
        // Keep our cached view in sync.
        *self = serde_json::from_value(disk).unwrap_or_default();
        Ok(())
    }

}

// Tiny POSIX flock binding so we don't pull in the whole libc crate for one syscall.
const LOCK_EX: i32 = 2;
const LOCK_UN: i32 = 8;

extern "C" {
    fn flock(fd: i32, operation: i32) -> i32;
}

unsafe fn libc_flock(fd: i32, op: i32) -> i32 {
    flock(fd, op)
}
