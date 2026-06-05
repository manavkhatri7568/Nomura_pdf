"""Shared FastAPI dependencies and the connector factory.

``get_config`` is overridable via ``app.dependency_overrides`` (used by tests).
``build_connector`` picks the email source per request; for ``graph`` it reuses
an ``httpx.Client`` stashed on ``app.state.graph_client`` when present (tests
inject an in-process client pointed at the mock app), otherwise it builds its
own client from the configured base URL.
"""

from typing import Optional

import httpx
from fastapi import Depends, Request

from classifier.rule_classifier import RuleClassifier
from config.config_store import ConfigStore
from config.settings import EmailAgentConfig
from connectors.graph_connector import GraphConnector
from connectors.local_connector import LocalEmailConnector
from storage.db_index import DBIndex
from storage.file_store import FileStore

# Single live config, wrapped so /config edits mutate the object the classifier
# reads (applied immediately; persisted to disk; re-loaded on startup).
_config_store = ConfigStore(EmailAgentConfig())


def get_config() -> EmailAgentConfig:
    return _config_store.config


def get_config_store() -> ConfigStore:
    return _config_store


def get_classifier(cfg: EmailAgentConfig = Depends(get_config)) -> RuleClassifier:
    return RuleClassifier(cfg)


def get_correlation_id(request: Request) -> str:
    return getattr(request.state, "correlation_id", "unknown")


def build_connector(source: str, cfg: EmailAgentConfig, app):
    if source == "graph":
        client: Optional[httpx.Client] = getattr(app.state, "graph_client", None)
        return GraphConnector(
            base_url=cfg.graph_base_url,
            tenant_id=cfg.graph_tenant_id,
            client_id=cfg.graph_client_id,
            client_secret=cfg.graph_client_secret,
            mailbox=cfg.graph_mailbox,
            folder=cfg.graph_folder,
            page_size=cfg.graph_page_size,
            prefer_text=cfg.graph_prefer_text,
            client=client,
        )
    return LocalEmailConnector(cfg.inbox_path)


def open_db(cfg: EmailAgentConfig) -> DBIndex:
    return DBIndex(cfg.db_path)


def open_store(cfg: EmailAgentConfig) -> FileStore:
    return FileStore(cfg.processed_path)
