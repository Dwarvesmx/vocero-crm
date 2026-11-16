import asyncio
import unittest
from comercial_v1 import ComercialTools


class Response:
    status_code = 200

    def json(self):
        return {"pedidos": [{"estado": "pendiente", "enlace": "https://payments.example.com/prueba"}]}


class Crm:
    def __init__(self):
        self.calls = []

    async def _request(self, *args, **kwargs):
        self.calls.append((args, kwargs))
        return Response()


class ComercialTest(unittest.TestCase):
    def test_disabled(self):
        tools = ComercialTools(Crm(), "trusted", "dispatch", "inbound")
        self.assertEqual(tools.schemas(), [])
        self.assertFalse(asyncio.run(tools.execute("comercial_catalogo", {}, "call"))["ok"])

    def test_context_and_retries(self):
        crm = Crm()
        tools = ComercialTools(crm, "trusted", "dispatch", "inbound", enabled=True)
        args = {"cotizacionId": "q", "version": 1}
        for _ in range(2):
            self.assertTrue(asyncio.run(tools.execute("comercial_aceptar", args, "call"))["ok"])
        self.assertEqual(crm.calls[0], crm.calls[1])
        self.assertEqual(crm.calls[0][1]["json"]["conversationId"], "trusted")
        self.assertEqual(crm.calls[0][1]["json"]["mensajeId"], "inbound")
        self.assertFalse(asyncio.run(tools.execute("comercial_aceptar", {**args, "conversationId": "other"}, "call"))["ok"])

    def test_link(self):
        tools = ComercialTools(Crm(), "trusted", "dispatch", "inbound", enabled=True)
        result = asyncio.run(tools.execute("comercial_enlace_cobro", {"cotizacionId": "q"}, "call"))
        self.assertEqual(result["enlace"], "https://payments.example.com/prueba")


if __name__ == "__main__":
    unittest.main()
