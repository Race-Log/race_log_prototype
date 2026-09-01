from collections.abc import Generator

import psycopg
from psycopg.rows import dict_row

from app.config import settings


def get_db() -> Generator[psycopg.Connection, None, None]:
    with psycopg.connect(settings.database_url, row_factory=dict_row) as connection:
        yield connection
