use serde::Serialize;
use std::{
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder},
    Emitter, Manager,
};

const OPENED_FILES_EVENT: &str = "hilldown://open-files";
const MENU_EVENT: &str = "hilldown://menu";

#[derive(Default)]
struct PendingOpenedFiles(Mutex<Vec<String>>);

impl PendingOpenedFiles {
    fn push(&self, paths: Vec<String>) {
        let mut pending = self
            .0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        pending.extend(paths);
    }

    fn take(&self) -> Vec<String> {
        let mut pending = self
            .0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        pending.drain(..).collect()
    }
}

#[derive(Serialize)]
struct OpenedMarkdownDocument {
    contents: String,
    name: String,
    path: String,
}

/// Opt HillDown out of macOS automatic text substitution — smart dashes,
/// smart quotes, text replacement, and period substitution (one default key
/// each, see below). The editor works on raw Markdown, where these corrupt
/// syntax — e.g. `---` becomes an em dash and never renders as a horizontal
/// rule. Overriding these defaults in the app domain takes precedence over
/// the system-wide setting the text engine would otherwise consult. Must run
/// before the WebView's text system starts editing.
#[cfg(target_os = "macos")]
fn disable_smart_substitutions() {
    use objc2_foundation::{NSString, NSUserDefaults};

    let defaults = NSUserDefaults::standardUserDefaults();
    for key in [
        "NSAutomaticDashSubstitutionEnabled",
        "NSAutomaticQuoteSubstitutionEnabled",
        "NSAutomaticTextReplacementEnabled",
        "NSAutomaticPeriodSubstitutionEnabled",
    ] {
        defaults.setBool_forKey(false, &NSString::from_str(key));
    }
}

/// Build the native application menu. Custom items carry stable ids that are
/// emitted verbatim on `MENU_EVENT`; the frontend (see `App.tsx`) matches on
/// those ids to dispatch the corresponding editor command. Predefined items
/// (Cut/Copy/Paste/Select All, Minimize, Fullscreen, About, Hide/Quit) use
/// Tauri's native, OS-provided behaviour. Undo/Redo are custom items because
/// the app drives its own history model rather than the textarea's native
/// undo stack.
fn build_menu<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    titles: &[String],
) -> tauri::Result<tauri::menu::Menu<R>> {
    #[cfg_attr(target_os = "macos", allow(unused_mut))]
    let mut file = SubmenuBuilder::new(app, "File")
        .item(&MenuItemBuilder::with_id("new", "New").accelerator("CmdOrCtrl+N").build(app)?)
        .item(&MenuItemBuilder::with_id("open", "Open…").accelerator("CmdOrCtrl+O").build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("save", "Save").accelerator("CmdOrCtrl+S").build(app)?)
        .item(&MenuItemBuilder::with_id("saveAs", "Save As…").accelerator("CmdOrCtrl+Shift+S").build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("exportHtml", "Export as HTML…").build(app)?)
        .item(&MenuItemBuilder::with_id("print", "Print…").accelerator("CmdOrCtrl+P").build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("closeTab", "Close Tab").accelerator("CmdOrCtrl+W").build(app)?);

    // macOS gets Quit via the application menu; give non-macOS platforms a
    // menu-driven Quit/Exit in File so it isn't duplicated on macOS.
    #[cfg(not(target_os = "macos"))]
    {
        file = file.separator().quit();
    }

    let file = file.build()?;

    let edit = SubmenuBuilder::new(app, "Edit")
        .item(&MenuItemBuilder::with_id("undo", "Undo").accelerator("CmdOrCtrl+Z").build(app)?)
        .item(&MenuItemBuilder::with_id("redo", "Redo").accelerator("CmdOrCtrl+Shift+Z").build(app)?)
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .separator()
        .item(&MenuItemBuilder::with_id("copyMarkdown", "Copy as Markdown").build(app)?)
        .item(&MenuItemBuilder::with_id("copyHtml", "Copy as HTML").build(app)?)
        .build()?;

    let format = SubmenuBuilder::new(app, "Format")
        .item(&MenuItemBuilder::with_id("bold", "Bold").accelerator("CmdOrCtrl+B").build(app)?)
        .item(&MenuItemBuilder::with_id("italic", "Italic").accelerator("CmdOrCtrl+I").build(app)?)
        .item(&MenuItemBuilder::with_id("link", "Link").accelerator("CmdOrCtrl+K").build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("heading1", "Heading 1").build(app)?)
        .item(&MenuItemBuilder::with_id("heading2", "Heading 2").build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("unordered", "Bulleted List").build(app)?)
        .item(&MenuItemBuilder::with_id("ordered", "Numbered List").build(app)?)
        .item(&MenuItemBuilder::with_id("task", "Task List").build(app)?)
        .item(&MenuItemBuilder::with_id("quote", "Quote").build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("code", "Code Block").build(app)?)
        .item(&MenuItemBuilder::with_id("table", "Table").build(app)?)
        .item(&MenuItemBuilder::with_id("divider", "Divider").build(app)?)
        .build()?;

    let view = SubmenuBuilder::new(app, "View")
        .item(&MenuItemBuilder::with_id("viewEdit", "Editor Only").accelerator("CmdOrCtrl+Alt+1").build(app)?)
        .item(&MenuItemBuilder::with_id("viewSplit", "Split").accelerator("CmdOrCtrl+Alt+2").build(app)?)
        .item(&MenuItemBuilder::with_id("viewPreview", "Preview").accelerator("CmdOrCtrl+Alt+3").build(app)?)
        .separator()
        .fullscreen()
        .build()?;

    let mut window = SubmenuBuilder::new(app, "Window")
        .minimize()
        .separator()
        .item(&MenuItemBuilder::with_id("nextTab", "Next Tab").accelerator("CmdOrCtrl+Alt+Right").build(app)?)
        .item(&MenuItemBuilder::with_id("prevTab", "Previous Tab").accelerator("CmdOrCtrl+Alt+Left").build(app)?)
        .separator();
    for (index, tab_title) in titles.iter().enumerate() {
        let position = index + 1; // 1-based; frontend parses Number(id.slice(7)) - 1
        let label = if tab_title.trim().is_empty() {
            format!("{position}. Untitled document")
        } else {
            format!("{position}. {tab_title}")
        };
        let mut item = MenuItemBuilder::with_id(format!("goToTab{position}"), label);
        if position <= 9 {
            item = item.accelerator(format!("CmdOrCtrl+{position}"));
        }
        window = window.item(&item.build(app)?);
    }
    let window = window.build()?;

    let mut menu = MenuBuilder::new(app);

    #[cfg(target_os = "macos")]
    {
        let app_menu = SubmenuBuilder::new(app, "HillDown")
            .about(None)
            .separator()
            .hide()
            .hide_others()
            .show_all()
            .separator()
            .quit()
            .build()?;
        menu = menu.item(&app_menu);
    }

    menu = menu.item(&file).item(&edit).item(&format).item(&view).item(&window);

    #[cfg(not(target_os = "macos"))]
    {
        let help = SubmenuBuilder::new(app, "Help").about(None).build()?;
        menu = menu.item(&help);
    }

    menu.build()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "macos")]
    disable_smart_substitutions();

    let app = tauri::Builder::default()
        .manage(PendingOpenedFiles::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            read_markdown_document,
            take_pending_opened_file_paths,
            print_document,
            sync_tab_menu
        ])
        .on_menu_event(|app, event| {
            let id = event.id().0.clone();
            if let Err(error) = app.emit(MENU_EVENT, id) {
                eprintln!("failed to emit menu event: {error}");
            }
        })
        .setup(|app| {
            let startup_paths = markdown_file_paths_from_args(std::env::args());
            if !startup_paths.is_empty() {
                app.state::<PendingOpenedFiles>().push(startup_paths);
            }

            let menu = build_menu(app.handle(), &["Untitled document".to_string()])?;
            app.set_menu(menu)?;

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Tauri application");

    app.run(|app_handle, event| {
        #[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]
        if let tauri::RunEvent::Opened { urls } = event {
            enqueue_opened_file_paths(app_handle, markdown_file_paths_from_urls(urls));
        }
    });
}

#[tauri::command]
fn take_pending_opened_file_paths(state: tauri::State<'_, PendingOpenedFiles>) -> Vec<String> {
    state.take()
}

/// Open the native macOS print panel for the current webview. Delegates to
/// Tauri's `Webview::print()` -> wry's WKWebView print operation, which shows
/// the system print / "Save as PDF" sheet. `window.print()` is a no-op in
/// WKWebView, so the frontend calls this instead under Tauri.
#[cfg(desktop)]
#[tauri::command]
fn print_document<R: tauri::Runtime>(webview: tauri::Webview<R>) -> Result<(), String> {
    webview.print().map_err(|error| error.to_string())
}

/// Rebuild the native menu's Window submenu to list the currently open tabs.
/// Menu operations must run on the main thread; commands are dispatched off
/// it, so the rebuild + `set_menu` is scheduled via `run_on_main_thread`.
#[tauri::command]
fn sync_tab_menu(app: tauri::AppHandle, titles: Vec<String>) -> Result<(), String> {
    let handle = app.clone();
    app.run_on_main_thread(move || {
        match build_menu(&handle, &titles) {
            Ok(menu) => {
                if let Err(error) = handle.set_menu(menu) {
                    eprintln!("failed to set menu: {error}");
                }
            }
            Err(error) => eprintln!("failed to rebuild menu: {error}"),
        }
    })
    .map_err(|error| error.to_string())
}

#[tauri::command]
fn read_markdown_document(path: String) -> Result<OpenedMarkdownDocument, String> {
    let path_buf = PathBuf::from(&path);
    if !is_markdown_path(&path_buf) {
        return Err(format!("Unsupported file type: {}", path_buf.display()));
    }

    let contents = std::fs::read_to_string(&path_buf)
        .map_err(|error| format!("Failed to read {}: {error}", path_buf.display()))?;
    let name = path_buf
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("Untitled.md")
        .to_string();

    Ok(OpenedMarkdownDocument {
        contents,
        name,
        path,
    })
}

#[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]
fn enqueue_opened_file_paths<R: tauri::Runtime>(app_handle: &tauri::AppHandle<R>, paths: Vec<String>) {
    if paths.is_empty() {
        return;
    }

    app_handle.state::<PendingOpenedFiles>().push(paths.clone());
    if let Err(error) = app_handle.emit(OPENED_FILES_EVENT, paths) {
        eprintln!("failed to emit opened file paths: {error}");
    }
}

#[cfg(any(target_os = "macos", target_os = "ios", target_os = "android", test))]
fn markdown_file_paths_from_urls(urls: Vec<tauri::Url>) -> Vec<String> {
    urls.into_iter()
        .filter_map(|url| url.to_file_path().ok())
        .filter_map(markdown_file_path_string)
        .collect()
}

fn markdown_file_paths_from_args<I>(args: I) -> Vec<String>
where
    I: IntoIterator<Item = String>,
{
    args.into_iter()
        .skip(1)
        .filter(|arg| !arg.starts_with('-'))
        .filter_map(|arg| markdown_file_path_string(PathBuf::from(arg)))
        .collect()
}

fn markdown_file_path_string(path: PathBuf) -> Option<String> {
    is_markdown_path(&path).then(|| path.into_os_string().into_string().ok())?
}

fn is_markdown_path(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            matches!(
                extension.to_ascii_lowercase().as_str(),
                "md" | "markdown" | "mdown" | "mkd"
            )
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filters_opened_urls_to_markdown_file_paths() {
        let urls = vec![
            tauri::Url::from_file_path("/tmp/notes.md").expect("file URL"),
            tauri::Url::from_file_path("/tmp/readme.markdown").expect("file URL"),
            tauri::Url::parse("https://example.com/remote.md").expect("remote URL"),
            tauri::Url::from_file_path("/tmp/image.png").expect("file URL"),
        ];

        assert_eq!(
            markdown_file_paths_from_urls(urls),
            vec![
                "/tmp/notes.md".to_string(),
                "/tmp/readme.markdown".to_string(),
            ],
        );
    }

    #[test]
    fn filters_startup_args_to_markdown_file_paths() {
        assert_eq!(
            markdown_file_paths_from_args([
                "/Applications/HillDown.app/Contents/MacOS/hilldown".to_string(),
                "/tmp/notes.md".to_string(),
                "--flag".to_string(),
                "/tmp/draft.txt".to_string(),
            ]),
            vec!["/tmp/notes.md".to_string()],
        );
    }
}
