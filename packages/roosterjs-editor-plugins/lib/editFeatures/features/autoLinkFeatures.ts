import { removeLink, replaceWithNode } from 'roosterjs-editor-api';
import {
    ChangeSource,
    ContentEditFeature,
    IEditor,
    Keys,
    LinkData,
    PluginEvent,
    PluginEventType,
    PluginKeyboardEvent,
    ClipboardData,
} from 'roosterjs-editor-types';
import {
    cacheGetEventData,
    clearEventDataCache,
    LinkInlineElement,
    matchLink,
} from 'roosterjs-editor-dom';

/**
 * When user type, they may end a link with a puncatuation, i.e. www.bing.com;
 * we need to trim off the trailing puncatuation before turning it to link match
 */
const TRAILING_PUNCTUATION_REGEX = /[.+=\s:;"',>]+$/i;
const MINIMUM_LENGTH = 5;

/**
 * AutoLink edit feature, provides the ability to automatically convert text user typed or pasted
 * in hyperlink format into a real hyperlink
 */
const AutoLink: ContentEditFeature = {
    keys: [Keys.ENTER, Keys.SPACE, Keys.CONTENTCHANGED],
    shouldHandleEvent: cacheGetLinkData,
    handleEvent: autoLink,
};

/**
 * UnlinkWhenBackspaceAfterLink edit feature, provides the ability to convert a hyperlink back into text
 * if user presses BACKSPACE right after a hyperlink
 */
const UnlinkWhenBackspaceAfterLink: ContentEditFeature = {
    keys: [Keys.BACKSPACE],
    shouldHandleEvent: hasLinkBeforeCursor,
    handleEvent: (event, editor) => {
        event.rawEvent.preventDefault();
        removeLink(editor);
    },
    defaultDisabled: true,
};

function cacheGetLinkData(event: PluginEvent, editor: IEditor): LinkData {
    return event.eventType == PluginEventType.KeyDown ||
        (event.eventType == PluginEventType.ContentChanged && event.source == ChangeSource.Paste)
        ? cacheGetEventData(event, 'LINK_DATA', () => {
              // First try to match link from the whole paste string from the plain text in clipboard.
              // This helps when we paste a link next to some existing character, and the text we got
              // from clipboard will only contain what we pasted, any existing characters will not
              // be included.
              let clipboardData =
                  event.eventType == PluginEventType.ContentChanged &&
                  event.source == ChangeSource.Paste &&
                  (event.data as ClipboardData);
              let link = matchLink((clipboardData.text || '').trim());
              let searcher = editor.getContentSearcherOfCursor(event);

              // In case the matched link is already inside a <A> tag, we do a range search.
              // getRangeFromText will return null if the given text is already in a LinkInlineElement
              if (link && searcher.getRangeFromText(link.originalUrl, false /*exactMatch*/)) {
                  return link;
              }

              let word = searcher && searcher.getWordBefore();
              if (word && word.length > MINIMUM_LENGTH) {
                  // Check for trailing punctuation
                  let trailingPunctuations = word.match(TRAILING_PUNCTUATION_REGEX);
                  let trailingPunctuation = (trailingPunctuations || [])[0] || '';
                  let candidate = word.substring(0, word.length - trailingPunctuation.length);

                  // Do special handling for ')', '}', ']'
                  ['()', '{}', '[]'].forEach(str => {
                      if (
                          candidate[candidate.length - 1] == str[1] &&
                          candidate.indexOf(str[0]) < 0
                      ) {
                          candidate = candidate.substr(0, candidate.length - 1);
                      }
                  });

                  // Match and replace in editor
                  return matchLink(candidate);
              }
              return null;
          })
        : null;
}

function hasLinkBeforeCursor(event: PluginKeyboardEvent, editor: IEditor): boolean {
    let contentSearcher = editor.getContentSearcherOfCursor(event);
    let inline = contentSearcher.getInlineElementBefore();
    return inline instanceof LinkInlineElement;
}

function autoLink(event: PluginEvent, editor: IEditor) {
    let anchor = editor.getDocument().createElement('a');
    let linkData = cacheGetLinkData(event, editor);

    // Need to get searcher before we enter the async callback since the callback can happen when cursor is moved to next line
    // and at that time a new searcher won't be able to find the link text to replace
    let searcher = editor.getContentSearcherOfCursor();
    anchor.textContent = linkData.originalUrl;
    anchor.href = linkData.normalizedUrl;

    editor.runAsync(() => {
        editor.addUndoSnapshot(
            () => {
                replaceWithNode(
                    editor,
                    linkData.originalUrl,
                    anchor,
                    false /* exactMatch */,
                    searcher
                );

                // The content at cursor has changed. Should also clear the cursor data cache
                clearEventDataCache(event);
                return anchor;
            },
            ChangeSource.AutoLink,
            true /*canUndoByBackspace*/
        );
    });
}

/**
 * Settings for auto link features
 */
export default interface AutoLinkFeatureSettings {
    /**
     * When press Space or Enter after a hyperlink-like string, convert the string to a hyperlink
     * @default true
     */
    autoLink: boolean;

    /**
     * Unlink when backspace right after a hyperlink
     * @default false
     */
    unlinkWhenBackspaceAfterLink: boolean;
}

/**
 * @internal
 */
export const AutoLinkFeatures: Record<keyof AutoLinkFeatureSettings, ContentEditFeature> = {
    autoLink: AutoLink,
    unlinkWhenBackspaceAfterLink: UnlinkWhenBackspaceAfterLink,
};
