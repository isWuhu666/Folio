from typing import NotRequired, TypedDict


class Diagnostic(TypedDict):
    code: str
    message: str
    page: NotRequired[int]
    source: NotRequired[str]


class PdfResult(TypedDict):
    title: str
    mode: str
    pageCount: int
    bodyHtml: str
    diagnostics: list[Diagnostic]
    pages: list[dict]
