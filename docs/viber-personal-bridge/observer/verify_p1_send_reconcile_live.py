"""Read-only reconciliation for one previously claimed controlled Send."""
from __future__ import annotations
import argparse,base64,json,os
from pathlib import Path
import stat,sys
_S=Path(__file__).absolute();_I=_S.lstat();_R=getattr(stat,"FILE_ATTRIBUTE_REPARSE_POINT",0x400)
if not stat.S_ISREG(_I.st_mode) or getattr(_I,"st_file_attributes",0)&_R or _S.resolve(strict=True)!=_S: raise SystemExit(2)
sys.path.insert(0,str(_S.parent))
import g3_process,g3_state,p1_paired_queries,probe_db_schema,probe_key_presence,qt_readonly_fixture,recover_sid_key
from observe_g3 import QtRows,lock_session,open_source,source_identity,source_path
from observe_g3_sid import find_single_session

def result(status,code="",observed=False,source_event_id=None):
 return {"status":status,"error_code":code,"outbound_occurrence_observed":observed,
         "outbound_source_event_id":source_event_id,
         "delivery_verified":False,"private_text_exported":False,"identifiers_exported":False,
         "messages_sent_by_reconciliation":0,"crm_contacted":False}

def run(session_path,test_id,expected_text,after_event_id):
 context=db=lock=guard=None;name=None
 try:
  session=g3_state.load_session(session_path);lock=lock_session(g3_state,session_path)
  guard=g3_process.capture(probe_key_presence)
  if not guard.alive(): return result("FAILED","TARGET_UNAVAILABLE")
  context=qt_readonly_fixture.initialize_qt(session["bindings_path"])
  if qt_readonly_fixture.run_fixture(context)["status"]!="PASS": return result("FAILED","SOURCE_UNAVAILABLE")
  path=source_path();identity=source_identity(path)
  candidate=recover_sid_key.derive(recover_sid_key.static_prefix(),recover_sid_key.current_sid())
  db,name=open_source(context,qt_readonly_fixture,probe_db_schema,path,[candidate]);candidate=b"";rows=QtRows(context,db)
  prefix="EGXG3-"+session["run_id"]
  if not db.transaction(): return result("FAILED","SOURCE_UNAVAILABLE")
  try:
   anchor=p1_paired_queries.resolve_anchor(rows,prefix+"-PHONE",prefix+"-DESKTOP")
   proof=p1_paired_queries.reconcile_outbound(rows,anchor,expected_text,after_event_id)
  finally:
   if not db.rollback(): return result("FAILED","SOURCE_UNAVAILABLE")
  if source_identity(path)!=identity or source_path()!=path or not guard.alive(): return result("FAILED","SOURCE_CHANGED")
  return result("SUBMITTED_UNCONFIRMED" if proof["observed"] else "UNKNOWN","",proof["observed"],proof.get("source_event_id"))
 except Exception:return result("FAILED","RECONCILE_FAILED")
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

if __name__=="__main__":
 with open(os.devnull,"w",encoding="utf-8") as null:os.dup2(null.fileno(),2)
 p=argparse.ArgumentParser(add_help=False);p.add_argument("--test-id",required=True);p.add_argument("--text-base64",required=True);p.add_argument("--after-event-id",required=True,type=int)
 try:
  a=p.parse_args();valid=len(a.test_id)==8 and all(c in "0123456789ABCDEF" for c in a.test_id)
  expected=base64.b64decode(a.text_base64,validate=True).decode("utf-8")
  valid=valid and (expected is None or (0<len(expected)<=500 and "\0" not in expected and "\r" not in expected))
  valid=valid and 1<=a.after_event_id<=(1<<63)-1
  print(json.dumps(run(find_single_session(),a.test_id,expected,a.after_event_id) if valid else result("FAILED","ARGUMENT_INVALID"),separators=(",",":")),flush=True)
 except BaseException:print(json.dumps(result("FAILED","RECONCILE_FAILED"),separators=(",",":")),flush=True)
