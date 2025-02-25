import {
  App,
  Editor,
  EditorTransaction,
  MarkdownView,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
} from "obsidian";

interface CarryForwardPluginSettings {
  linkText: string;
  copiedLinkText: string;
  lineFormatFrom: string;
  lineFormatTo: string;
  removeLeadingWhitespace: boolean;
}

const DEFAULT_SETTINGS: CarryForwardPluginSettings = {
  linkText: "",
  copiedLinkText: "(see {{LINK}})",
  lineFormatFrom: "\\s*$",
  lineFormatTo: " (see {{LINK}})",
  removeLeadingWhitespace: true,
};

const genID = (length = 5) => {
  const characters = "abcdefghijklmnopqrstuvwxyz-0123456789";
  let id = "";
  while (id.length < length) {
    id += characters[Math.floor(Math.random() * characters.length)];
  }
  return id.slice(0, length);
};

enum CopyTypes {
  SeparateLines,
  CombinedLines,
  LinkOnly,
  LinkOnlyEmbed,
}

const blockIDRegex = /(?<=[\s^])\^[a-zA-Z0-9-]+$/u;

const copyForwardLines = (
  editor: Editor,
  view: MarkdownView,
  settings: CarryForwardPluginSettings,
  copy: CopyTypes = CopyTypes.SeparateLines
) => {
  const regexValidation = validateRegex(settings.lineFormatFrom);
  if (regexValidation.valid !== true) {
    new Notice(
      `Error: 'From' setting is invalid:\n\n${regexValidation.string}\n\nPlease update the Carry-Forward settings and try again.`,
      1000 * 30 // 30 seconds
    );
    return;
  }

  const cursorFrom = editor.getCursor("from");
  const cursorTo = editor.getCursor("to");
  const minLine = cursorFrom.line;
  const maxLine = cursorTo.line;

  const transaction: EditorTransaction = {
    changes: [],
  };

  const file = view.file;

  const updatedLines: string[] = [];
  const copiedLines: string[] = [];
  let newID = "";
  for (let lineNumber = minLine; lineNumber <= maxLine; lineNumber++) {
    let line = editor.getLine(lineNumber);
    let copiedLine = line;
    if (settings.removeLeadingWhitespace === true && (lineNumber === minLine && cursorFrom.ch === cursorTo.ch)) {
      // Remove leading whitespace if the user is copying a full line without
      // having selected a specific part of the line:
      copiedLine = copiedLine.replace(/^\s*/, '');
    }

    if (
      (lineNumber === minLine || lineNumber === maxLine) &&
      !(minLine === maxLine && cursorFrom.ch === cursorTo.ch)
    ) {
      copiedLine = line.slice(
        lineNumber === minLine ? cursorFrom.ch : 0,
        lineNumber === maxLine ? cursorTo.ch : line.length - 1
      );
    }

    if (
      editor.getLine(lineNumber).match(/^\s*$/) &&
      !(lineNumber === minLine && minLine === maxLine)
    ) {
      copiedLines.push(copiedLine);
      updatedLines.push(line);
      continue;
    }

    if (copy === CopyTypes.SeparateLines || lineNumber === minLine) {
      // Does the line already have a block ID?
      const blockID = line.match(blockIDRegex);
      let link = "";
      if (blockID === null) {
        // There is NOT an existing line ID:
        newID = `^${genID()}`;
        link = view.app.fileManager.generateMarkdownLink(
          file,
          "/",
          `#${newID}`,
          settings.linkText
        );
        line = line.replace(/\s*?$/, ` ${newID}`);
        if (copy === CopyTypes.LinkOnly || copy === CopyTypes.LinkOnlyEmbed) {
          link = (copy === CopyTypes.LinkOnlyEmbed ? "!" : "") + link;
          copiedLine =
            copy === CopyTypes.LinkOnlyEmbed
              ? link
              : settings.copiedLinkText.replace(/{{LINK(\|?.*)}}/, `${link.replace(/]]$/, "")}$1]]`);
        } else {
          copiedLine = copiedLine.replace(
            new RegExp(settings.lineFormatFrom, "u"),
            settings.lineFormatTo.replace(/{{LINK(\|?.*)}}/, `${link.replace(/]]$/, "")}$1]]`)
          );
        }
      } else {
        // There IS an existing line ID:
        link = view.app.fileManager.generateMarkdownLink(
          file,
          "/",
          `#${blockID}`,
          settings.linkText
        );
        if (copy === CopyTypes.LinkOnly || copy === CopyTypes.LinkOnlyEmbed) {
          link = (copy === CopyTypes.LinkOnlyEmbed ? "!" : "") + link;
          copiedLine =
            copy === CopyTypes.LinkOnlyEmbed
              ? link
              : settings.copiedLinkText.replace(/{{LINK(\|?.*)}}/, `${link.replace(/]]$/, "")}$1]]`);
        } else {
          copiedLine = copiedLine
            .replace(blockIDRegex, "")
            .replace(
              new RegExp(settings.lineFormatFrom, "u"),
              settings.lineFormatTo.replace(/{{LINK(\|?.*)}}/, `${link.replace(/]]$/, "")}$1]]`)
            );
        }
      }
    }

    if (
      !(
        (copy === CopyTypes.LinkOnly || copy === CopyTypes.LinkOnlyEmbed) &&
        lineNumber !== minLine
      )
    ) {
      copiedLines.push(copiedLine);
    }
    updatedLines.push(line);
  }

  navigator.clipboard.writeText(copiedLines.join("\n")).then(() => {
    new Notice("Copied");
  });

  transaction.changes?.push({
    from: { line: minLine, ch: 0 },
    to: { line: maxLine, ch: editor.getLine(maxLine).length },
    text: updatedLines.join("\n"),
  });
  transaction.selection = { from: cursorFrom, to: cursorTo };
  editor.transaction(transaction);
};

export default class CarryForwardPlugin extends Plugin {
  settings: CarryForwardPluginSettings;

  async onload() {
    console.log("loading carry-forward-line plugin");

    await this.loadSettings();

    this.addCommand({
      id: "carry-line-forward-separate-lines",
      name: "Copy selection with each line linked to its copied source",
      editorCallback: (editor: Editor, view: MarkdownView) => {
        return copyForwardLines(
          editor,
          view,
          this.settings,
          CopyTypes.SeparateLines
        );
      },
    });

    this.addCommand({
      id: "carry-line-forward-combined-lines",
      name: "Copy selection with first line linked to its copied source",
      editorCallback: (editor: Editor, view: MarkdownView) => {
        return copyForwardLines(
          editor,
          view,
          this.settings,
          CopyTypes.CombinedLines
        );
      },
    });

    this.addCommand({
      id: "carry-line-forward-link-only",
      name: "Copy link to line",
      editorCallback: (editor: Editor, view: MarkdownView) => {
        return copyForwardLines(
          editor,
          view,
          this.settings,
          CopyTypes.LinkOnly
        );
      },
    });

    this.addCommand({
      id: "carry-line-forward-embed-link-only",
      name: "Copy embed link to line",
      editorCallback: (editor: Editor, view: MarkdownView) => {
        return copyForwardLines(
          editor,
          view,
          this.settings,
          CopyTypes.LinkOnlyEmbed
        );
      },
    });

    this.addSettingTab(new CarryForwardSettingTab(this.app, this));
  }

  onunload() {
    console.log("unloading carry-forward-line plugin");
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

const validateRegex = (
  regexString: string
): { valid: boolean | null; string: string } => {
  let updatedRegexString = regexString
    // Because the plugin's settings are stored in JSON, characters like
    // \n get double-escaped, and then do not get replaced automatically
    // on use. This was causing To strings not to parse \n, etc.
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\r/g, "\r");

  try {
    new RegExp(updatedRegexString, "u");
    return { valid: true, string: updatedRegexString };
  } catch (e) {
    return {
      valid: false,
      string: `"${updatedRegexString}": "${e}"`,
    };
  }
};

class CarryForwardSettingTab extends PluginSettingTab {
  plugin: CarryForwardPlugin;

  constructor(app: App, plugin: CarryForwardPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    let { containerEl } = this;

    containerEl.empty();

    containerEl.createEl("h2", { text: "Carry-forward" });

    new Setting(containerEl)
      .setName("Link text")
      .setDesc(
        "Text of links. Leaving this blank will display the text of the actual link."
      )
      .addText((text) => {
        const settings = this.plugin.settings;
        text.setValue(settings.linkText).onChange(async (value) => {
          settings.linkText = value;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Copied text")
      .setDesc(
        "The full text of copied references. Use {{LINK}} to place the link."
      )
      .addText((text) => {
        const settings = this.plugin.settings;
        text.setValue(settings.copiedLinkText).onChange(async (value) => {
          settings.copiedLinkText = value;
          await this.plugin.saveSettings();
        });
      });

    const fromToEl = containerEl.createEl("div");
    fromToEl.addClass("from-to-rule");

    if (validateRegex(this.plugin.settings.lineFormatFrom).valid !== true) {
      fromToEl.addClass("invalid");
    }

    new Setting(fromToEl)
      .setName("Transform copied line")
      .setDesc(
        "When copying a line, replace the first match of a Regular Expression with text. Use {{LINK}} in the To field to place the link."
      )
      .addText((text) =>
        text
          .setPlaceholder(
            `From (Default: "${DEFAULT_SETTINGS.lineFormatFrom}")`
          )
          .setValue(this.plugin.settings.lineFormatFrom)
          .onChange(async (value) => {
            if (value === "") {
              this.plugin.settings.lineFormatFrom =
                DEFAULT_SETTINGS.lineFormatFrom;
            } else {
              if (validateRegex(value).valid !== true) {
                fromToEl.addClass("invalid");
              } else {
                fromToEl.removeClass("invalid");
              }
              this.plugin.settings.lineFormatFrom = value;
            }
            await this.plugin.saveSettings();
          })
      )
      .addText((text) =>
        text
          .setPlaceholder(`To (Default: "${DEFAULT_SETTINGS.lineFormatTo}")`)
          .setValue(this.plugin.settings.lineFormatTo)
          .onChange(async (value) => {
            if (value === "") {
              this.plugin.settings.lineFormatTo = DEFAULT_SETTINGS.lineFormatTo;
            } else {
              this.plugin.settings.lineFormatTo = value;
            }
            await this.plugin.saveSettings();
          })
      );

      new Setting(containerEl)
      .setName("Remove leading whitespace from first line")
      .setDesc(
        "When copying a line without having selected a specific part of that line, remove any whitespace at the beginning of the copy."
      )
      .addToggle((toggle) => {
        const settings = this.plugin.settings;
        toggle.setValue(settings.removeLeadingWhitespace).onChange(async (value) => {
          settings.removeLeadingWhitespace = value;
          await this.plugin.saveSettings();
        });
      });
  }
}
