/* Green Agenda, módulo dados: src/config-nuvem.js
   Configuração da nuvem (Firebase). Este arquivo é o ÚNICO interruptor entre
   o modo local (demonstração, tudo no aparelho, senha demo123) e o modo nuvem
   (Firestore compartilhado, login real por email e senha, base para push).

   Com `ativo: false` nada daqui é usado e o app funciona exatamente como
   antes. Com `ativo: true` e os seis valores preenchidos, src/nuvem.js carrega
   o SDK de vendor/firebase/ e passa a replicar as coleções.

   NENHUM valor aqui é segredo de verdade: a apiKey do Firebase identifica o
   projeto, não autoriza nada (quem autoriza é firestore.rules). Mesmo assim,
   este arquivo é versionado com os valores vazios de propósito; preencha só na
   cópia que vai ao ar. O passo a passo completo está em docs/NUVEM.md.

   De onde copiar cada valor, no console do Firebase (console.firebase.google.com):
   - firebase.*: engrenagem ao lado de "Visão geral do projeto" > Configurações
     do projeto > aba Geral > seção "Seus apps" > o app da Web (ícone </>) >
     "Configuração do SDK" com a opção "Configuração" marcada. Aparece um objeto
     firebaseConfig com exatamente estas seis chaves; copie valor por valor.
       apiKey            chave pública do projeto, começa com "AIza"
       authDomain        "<id-do-projeto>.firebaseapp.com"
       projectId         o id do projeto (minúsculas e hifens)
       storageBucket     "<id-do-projeto>.firebasestorage.app" (não é usado, mas
                         vem junto e não atrapalha)
       messagingSenderId número longo, é o remetente do Cloud Messaging
       appId             "1:<número>:web:<hash>"
   - vapidKey: Configurações do projeto > aba Cloud Messaging > seção
     "Configuração da Web" > "Certificados push da Web" > botão "Gerar par de
     chaves". Copie a chave pública (uma linha longa, começa com "B"). Só é
     usada pelo push no navegador; o app nativo (Capacitor) não precisa dela. */

export const configNuvem = {
  /** Liga a nuvem. Só vale se os seis valores de `firebase` estiverem preenchidos. */
  ativo: false,

  firebase: {
    apiKey: '',
    authDomain: '',
    projectId: '',
    storageBucket: '',
    messagingSenderId: '',
    appId: ''
  },

  /** Chave pública VAPID do Web Push (opcional; vazia desliga o push no navegador). */
  vapidKey: '',

  /** Caminho dos módulos do SDK, relativo a src/. Não precisa mudar. */
  pastaSdk: '../vendor/firebase/'
};

export default configNuvem;
