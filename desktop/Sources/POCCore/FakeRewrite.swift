import Foundation

/// Slice 1 has no model call (the architecture proves the Mac plumbing first). The "rewrite" is
/// the draft in capitals so it is obvious on screen that the paste-back worked.
/// Slice 2 replaces this with the shared coaching JavaScript.
public enum FakeRewrite {
    public static func rewrite(_ draft: String) -> String { draft.uppercased() }
}
