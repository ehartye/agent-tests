from app import svc


def test_serve():
    assert svc.serve() == 1
