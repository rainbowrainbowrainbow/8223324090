"""Open the marker-bound peer in Viber without exporting its number."""
from __future__ import annotations
import json,os,re,stat,sys,time
from pathlib import Path
from urllib.parse import quote
_S=Path(__file__).absolute();_I=_S.lstat();_R=getattr(stat,"FILE_ATTRIBUTE_REPARSE_POINT",0x400)
if not stat.S_ISREG(_I.st_mode) or getattr(_I,"st_file_attributes",0)&_R or _S.resolve(strict=True)!=_S:raise SystemExit(2)
sys.path.insert(0,str(_S.parent))
import g3_process,g3_state,p1_paired_queries,probe_db_schema,probe_key_presence,qt_readonly_fixture,recover_sid_key
from observe_g3 import QtRows,lock_session,open_source,source_identity,source_path
from observe_g3_sid import find_single_session
def out(status,code=""):
 return {"status":status,"error_code":code,"peer_value_exported":False,"messages_sent":0,"crm_contacted":False}
def run(session_path):
 context=db=lock=guard=None;name=None
 try:
  session=g3_state.load_session(session_path);lock=lock_session(g3_state,session_path);guard=g3_process.capture(probe_key_presence)
  if not guard.alive():return out("FAILED","TARGET_UNAVAILABLE")
  context=qt_readonly_fixture.initialize_qt(session["bindings_path"])
  if qt_readonly_fixture.run_fixture(context)["status"]!="PASS":return out("FAILED","SOURCE_UNAVAILABLE")
  path=source_path();identity=source_identity(path);candidate=recover_sid_key.derive(recover_sid_key.static_prefix(),recover_sid_key.current_sid())
  db,name=open_source(context,qt_readonly_fixture,probe_db_schema,path,[candidate]);candidate=b"";rows=QtRows(context,db);prefix="EGXG3-"+session["run_id"]
  if not db.transaction():return out("FAILED","SOURCE_UNAVAILABLE")
  try:
   anchor=p1_paired_queries.resolve_anchor(rows,prefix+"-PHONE",prefix+"-DESKTOP")
   values=rows("SELECT Number FROM Contact WHERE ContactID=:contact_id",{"contact_id":anchor["peer_contact_id"]},1,2)
  finally:
   if not db.rollback():return out("FAILED","SOURCE_UNAVAILABLE")
  if len(values)!=1 or not isinstance(values[0][0],str) or re.fullmatch(r"\+[1-9]\d{6,14}",values[0][0]) is None:return out("FAILED","PEER_NUMBER_UNAVAILABLE")
  if source_identity(path)!=identity or source_path()!=path or not guard.alive():return out("FAILED","SOURCE_CHANGED")
  os.startfile("viber://chat?number="+quote(values[0][0],safe=""));time.sleep(2)
  return out("CHAT_OPEN_REQUESTED")
 except Exception:return out("FAILED","OPEN_FAILED")
 finally:
  if db is not None:
   try:db.close()
   except Exception:pass
  db=None
  if context is not None and name is not None:
   try:context.sql.QSqlDatabase.removeDatabase(name)
   except Exception:pass
  if guard is not None:
   try:guard.close()
   except Exception:pass
  if lock is not None:
   try:lock.close()
   except Exception:pass
if __name__=="__main__":print(json.dumps(run(find_single_session()),separators=(",",":")),flush=True)
