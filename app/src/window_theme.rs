use tauri::{window::Color, WebviewWindow};

// Windows COLORREF is 0x00BBGGRR; alpha is not part of a caption color.
#[cfg(any(windows, test))]
fn color_ref(color: Color) -> u32 {
    u32::from_le_bytes([color.0, color.1, color.2, 0])
}

/// Windows 11 paints the native caption separately from the window background.
#[tauri::command]
pub fn set_title_bar_color(
    window: WebviewWindow,
    color: Color,
    text_color: Color,
) -> Result<(), String> {
    #[cfg(windows)]
    {
        use windows::Win32::{
            Foundation::COLORREF,
            Graphics::Dwm::{DwmSetWindowAttribute, DWMWA_CAPTION_COLOR, DWMWA_TEXT_COLOR},
        };

        let hwnd = window.hwnd().map_err(|error| error.to_string())?;
        for (attribute, value) in [
            (DWMWA_CAPTION_COLOR, COLORREF(color_ref(color))),
            (DWMWA_TEXT_COLOR, COLORREF(color_ref(text_color))),
        ] {
            // SAFETY: hwnd belongs to this live Tauri window. DWM reads the
            // COLORREF synchronously, with its exact size and matching attribute.
            unsafe {
                DwmSetWindowAttribute(
                    hwnd,
                    attribute,
                    (&value as *const COLORREF).cast(),
                    std::mem::size_of::<COLORREF>() as u32,
                )
            }
            .map_err(|error| format!("Could not set title bar color: {error}"))?;
        }
    }
    #[cfg(not(windows))]
    let _ = (window, color, text_color);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn theme_colors_use_windows_bgr_byte_order_without_alpha() {
        for (hex, expected) in [
            ("#f0f4ec", 0x00ec_f4f0),
            ("#edf5fa", 0x00fa_f5ed),
            ("#f3f6fc", 0x00fc_f6f3),
            ("#141622", 0x0022_1614),
            ("#34452e", 0x002e_4534),
            ("#eceaf6", 0x00f6_eaec),
        ] {
            let color: Color = serde_json::from_value(serde_json::json!(hex)).unwrap();
            assert_eq!(color_ref(color), expected);
        }
        assert_eq!(color_ref(Color(0x12, 0x34, 0x56, 0x78)), 0x0056_3412);
    }
}
