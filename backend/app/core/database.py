from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from app.core.config import settings

connect_args = {"check_same_thread": False} if "sqlite" in settings.database_url else {}

engine = create_engine(settings.database_url, connect_args=connect_args)

# Every request gets its own session.
SessionLocal = sessionmaker(
        autocommit=False, # don't execute single query until call db.commit()
        autoflush=False, # don't send single query to database until call db.flush()
        bind=engine) # this session must use this engine

Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

"""
 settings.database_url, connect_args
          │
          ▼
 create_engine(...)
          │
          ▼
      Engine
          │
          ▼
 sessionmaker(...)
          │
          ▼
    SessionLocal
          │
          ▼
  SessionLocal()
          │
          ▼
       Session
          │
 (queries, commits)
          │
          ▼
        Engine
          │
          ▼
 SQLite / PostgreSQL
"""
