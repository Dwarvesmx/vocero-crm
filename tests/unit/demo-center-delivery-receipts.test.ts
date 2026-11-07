import {beforeEach,it,expect,vi} from 'vitest';
import {zernioFetch} from '@/server/zernio';
import {consultarConfirmacionDemoZernio} from '@/server/zernio/whatsapp-envio';
import {isCommercialScope} from '@/server/inbox/message-scope';
vi.mock('@/server/zernio',()=>({zernioFetch:vi.fn()}));
vi.mock('@/server/zernio/whatsapp-credenciales',()=>({obtenerZernioWhatsAppPorOrg:async()=>({accountRef:'account',token:'synthetic'})}));
const input={organizationId:'org',accountRef:'account',threadRef:'thread',requestKey:'key',messageId:'wamid'};
const message={id:'wamid',accountId:'account',conversationId:'thread',platform:'whatsapp',direction:'outgoing',deliveryStatus:'delivered'};
beforeEach(()=>vi.resetAllMocks());
it('consulta ID exacto con cuenta/hilo y no reenvía',async()=>{
 vi.mocked(zernioFetch).mockResolvedValue({messages:[message],pagination:{hasMore:false}});
 expect(await consultarConfirmacionDemoZernio(input)).toEqual({messageId:'wamid',status:'delivered'});
 expect(zernioFetch).toHaveBeenCalledTimes(1);expect(vi.mocked(zernioFetch).mock.calls[0]![1]!.method).toBe('GET');
});
it('ACK sin ID no se asocia por contenido ni consulta',async()=>{expect(await consultarConfirmacionDemoZernio({...input,messageId:null})).toBeNull();expect(zernioFetch).not.toHaveBeenCalled();});
it('rechaza cuenta/hilo/dirección ajenos e IDs ambiguos',async()=>{
 for(const messages of [[{...message,accountId:'other'}],[{...message,conversationId:'other'}],[{...message,direction:'incoming'}],[message,message]]){
  vi.mocked(zernioFetch).mockResolvedValue({messages,pagination:{hasMore:false}});expect(await consultarConfirmacionDemoZernio(input)).toBeNull();
 }
});
it('fallo de lectura conserva incertidumbre sin nuevo POST',async()=>{vi.mocked(zernioFetch).mockRejectedValue(Error('synthetic timeout'));expect(await consultarConfirmacionDemoZernio(input)).toBeNull();expect(zernioFetch).toHaveBeenCalledTimes(1);});
it('compatibilidad comercial explícita sin reclasificar estados demo/blocked',()=>{expect(isCommercialScope(null)).toBe(true);expect(isCommercialScope(undefined)).toBe(true);expect(isCommercialScope('commercial')).toBe(true);expect(isCommercialScope('demo')).toBe(false);expect(isCommercialScope('blocked')).toBe(false);});
