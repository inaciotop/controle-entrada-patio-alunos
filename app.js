// ================================================================
// CONFIGURAÇÃO DO GOOGLE
// Troque o valor abaixo pelo Client ID gerado no Google Cloud Console.
// Veja o passo a passo que te enviei junto com este arquivo.
// ================================================================
const GOOGLE_CLIENT_ID = '815099174674-lnj6qetv19833nh3fad9gtjhs1rt39bc.apps.googleusercontent.com';

// Escopo do Drive (usado só no backup manual em XLSX, botão "Salvar no Drive")
const GOOGLE_DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';
// Escopo do Sheets (usado na lista compartilhada em tempo real)
const GOOGLE_SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

// Cole aqui o ID da pasta compartilhada pelo gestor para o backup em XLSX.
// Se deixar em branco, cada pessoa usa uma pasta pessoal "Backups Secretaria".
const ID_PASTA_COMPARTILHADA_DRIVE = '1w2k6iY6OFEBj29jenDXtmNgfwx2ZP77G';

// ================================================================
// LISTA COMPARTILHADA EM TEMPO (QUASE) REAL — Google Sheets
// Cole aqui o ID da planilha compartilhada (está na URL: .../d/ID_AQUI/edit).
// Deixe em branco para o app funcionar só localmente (modo antigo, offline).
// ================================================================
const ID_PLANILHA_COMPARTILHADA = '1XzDtelmTMIJoEsFdyIFVzXDcu3KjAdgNpJR0nGvNXWs';
const ABA_PLANILHA = 'Registros';
const CABECALHO_PLANILHA = ['Data', 'Horario', 'Tipo', 'Aluno', 'Matricula', 'Turma', 'Local', 'Telefone', 'Motivo', 'Autorizado'];
const INTERVALO_ATUALIZACAO_MS = 20000; // reconsulta a planilha a cada 20s

let googleTokenClient = null;
let googleAccessToken = null;
let registrosCache = []; // fonte única usada por toda a interface
let intervalPolling = null;

function modoListaCompartilhada() {
    return !!ID_PLANILHA_COMPARTILHADA;
}

function obterHistorico() {
    return registrosCache;
}

document.addEventListener('DOMContentLoaded', () => {
    atualizarStatusOffline();
    registrarServiceWorker();
    inicializarDados();
});

window.addEventListener('online', atualizarStatusOffline);
window.addEventListener('offline', atualizarStatusOffline);

function atualizarStatusOffline() {
    const aviso = document.getElementById('status-offline');
    if (!aviso) return;
    aviso.style.display = navigator.onLine ? 'none' : 'block';
}

function inicializarDados() {
    if (modoListaCompartilhada()) {
        const areaLogin = document.getElementById('area-login-google');
        if (areaLogin) areaLogin.style.display = 'flex';
        atualizarTabelaTela();
    } else {
        registrosCache = JSON.parse(localStorage.getItem('secretaria_db')) || [];
        atualizarTabelaTela();
    }
}

function registrarServiceWorker() {
    if (!('serviceWorker' in navigator)) return;

    navigator.serviceWorker.register('sw.js').then((registro) => {
        if (registro.waiting) {
            mostrarBannerAtualizacao(registro.waiting);
        }

        registro.addEventListener('updatefound', () => {
            const novoWorker = registro.installing;
            if (!novoWorker) return;

            novoWorker.addEventListener('statechange', () => {
                if (novoWorker.state === 'installed' && navigator.serviceWorker.controller) {
                    mostrarBannerAtualizacao(novoWorker);
                }
            });
        });

        registro.update();
    }).catch(err => {
        console.warn('Falha ao registrar o Service Worker:', err);
    });

    let jaRecarregou = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (jaRecarregou) return;
        jaRecarregou = true;
        window.location.reload();
    });
}

function mostrarBannerAtualizacao(workerEmEspera) {
    const banner = document.getElementById('banner-atualizacao');
    if (!banner) return;
    banner.style.display = 'flex';
    banner.querySelector('button').onclick = () => {
        workerEmEspera.postMessage({ tipo: 'SKIP_WAITING' });
        banner.style.display = 'none';
    };
}

function escaparHTML(texto) {
    const div = document.createElement('div');
    div.innerText = texto;
    return div.innerHTML;
}

function alternarCamposPorTipo() {
    const tipo = document.getElementById('tipo_registro').value;
    document.getElementById('campos_saida').style.display = tipo === 'SAÍDA' ? 'block' : 'none';
    document.getElementById('campos_atraso').style.display = tipo === 'ATRASO' ? 'block' : 'none';
    document.getElementById('campos_ocorrencia').style.display = tipo === 'OCORRENCIA' ? 'block' : 'none';

    if (tipo !== 'SAÍDA') {
        document.getElementById('motivo_obs').value = '';
        document.getElementById('autorizado_por').value = '';
    }
    if (tipo !== 'ATRASO') {
        document.getElementById('status_atraso').value = 'Justificado';
        document.getElementById('justificativa_atraso').value = '';
    }
    if (tipo !== 'OCORRENCIA') {
        document.getElementById('local_ocorrencia').value = 'Pátio';
        document.getElementById('detalhe_ocorrencia').value = '';
        document.getElementById('funcionario_ocorrencia').value = '';
    }
    document.getElementById('funcionario_ocorrencia').required = tipo === 'OCORRENCIA';
    verificarReincidencia();
}

function verificarReincidencia() {
    const nome = document.getElementById('aluno_nome').value.toLowerCase().trim();
    const turma = document.getElementById('aluno_turma').value.toLowerCase().trim();

    const alerta = document.getElementById('alerta-reincidencia');
    const inputTelefone = document.getElementById('responsavel_telefone');
    const labelTelefone = document.getElementById('label-telefone');

    if (!nome || !turma) {
        esconderCamposReincidencia();
        return;
    }

    const historico = obterHistorico();

    const ultimoRegistroComFone = [...historico].reverse().find(reg =>
        reg.aluno.toLowerCase().trim() === nome &&
        reg.turma.toLowerCase().trim() === turma &&
        reg.telefone
    );
    if (ultimoRegistroComFone && !inputTelefone.value) {
        inputTelefone.value = ultimoRegistroComFone.telefone;
    }

    const ultimoRegistroGeral = [...historico].reverse().find(reg =>
        reg.aluno.toLowerCase().trim() === nome &&
        reg.turma.toLowerCase().trim() === turma
    );
    if (ultimoRegistroGeral && ultimoRegistroGeral.matricula && ultimoRegistroGeral.matricula !== 'Não inf.') {
        if (!document.getElementById('aluno_matricula').value) {
            document.getElementById('aluno_matricula').value = ultimoRegistroGeral.matricula;
        }
    }

    const qtdAtrasos = historico.filter(reg =>
        reg.aluno.toLowerCase().trim() === nome &&
        reg.turma.toLowerCase().trim() === turma &&
        reg.tipo === 'ATRASO'
    ).length;

    if (qtdAtrasos > 0) {
        alerta.style.display = 'block';
        alerta.innerText = `⚠️ Aluno reincidente! Este será o ${qtdAtrasos + 1}º atraso do(a) aluno(a) na turma ${turma.toUpperCase()}.`;
    } else {
        alerta.style.display = 'none';
    }

    if (qtdAtrasos >= 2) {
        inputTelefone.required = true;
        labelTelefone.innerHTML = '🚨 WhatsApp do Responsável (Exigido - 3º Atraso):';
        labelTelefone.style.color = '#d63031';
    } else {
        inputTelefone.required = false;
        labelTelefone.innerHTML = '📱 WhatsApp do Responsável (Opcional):';
        labelTelefone.style.color = '';
    }
}

function esconderCamposReincidencia() {
    document.getElementById('alerta-reincidencia').style.display = 'none';
    document.getElementById('responsavel_telefone').required = false;
    document.getElementById('label-telefone').innerHTML = '📱 WhatsApp do Responsável (Opcional):';
    document.getElementById('label-telefone').style.color = '';
}

async function salvarOcorrencia() {
    const agora = new Date();
    const dataAtual = agora.toLocaleDateString('pt-BR');
    const horarioAtual = agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const telefoneInput = document.getElementById('responsavel_telefone').value;
    const telefoneLimpo = telefoneInput ? telefoneInput.replace(/\D/g, '') : '';

    const nomeAtual = document.getElementById('aluno_nome').value.trim().toUpperCase();
    const turmaAtual = document.getElementById('aluno_turma').value.trim().toUpperCase();
    const tipoReg = document.getElementById('tipo_registro').value;

    let motivoFinal = '';
    let localOcorrencia = '-';
    let responsavelRegistro = document.getElementById('autorizado_por').value.trim() || '-';
    if (tipoReg === 'ATRASO') {
        const status = document.getElementById('status_atraso').value;
        const detalhe = document.getElementById('justificativa_atraso').value.trim();
        motivoFinal = detalhe ? `${status} (${detalhe})` : status;
    } else if (tipoReg === 'OCORRENCIA') {
        localOcorrencia = document.getElementById('local_ocorrencia').value;
        const detalhe = document.getElementById('detalhe_ocorrencia').value.trim();
        motivoFinal = detalhe || 'Ocorrência registrada';
        const funcionario = document.getElementById('funcionario_ocorrencia').value.trim();
        if (!funcionario) {
            alert('Informe quem fez o registro da ocorrência.');
            return;
        }
        responsavelRegistro = funcionario;
    } else {
        motivoFinal = document.getElementById('motivo_obs').value.trim() || 'Saída antecipada';
    }

    const novoRegistro = {
        data: dataAtual,
        horario: horarioAtual,
        tipo: tipoReg,
        aluno: nomeAtual,
        matricula: document.getElementById('aluno_matricula').value.trim() || 'Não inf.',
        turma: turmaAtual,
        telefone: telefoneLimpo,
        local: localOcorrencia,
        motivo: motivoFinal,
        autorizado: responsavelRegistro
    };

    if (!novoRegistro.telefone) {
        const historicoAtual = obterHistorico();
        const registroAntigoComFone = [...historicoAtual].reverse().find(reg =>
            reg.aluno.toLowerCase().trim() === nomeAtual.toLowerCase() &&
            reg.turma.toLowerCase().trim() === turmaAtual.toLowerCase() &&
            reg.telefone
        );
        if (registroAntigoComFone) {
            novoRegistro.telefone = registroAntigoComFone.telefone;
        }
    }

    const btnSalvar = document.querySelector('#form-registro button[type="submit"]');

    if (modoListaCompartilhada()) {
        if (!googleAccessToken) {
            alert('Faça login com o Google primeiro (botão no topo da tela) para salvar na lista compartilhada.');
            return;
        }
        try {
            if (btnSalvar) { btnSalvar.disabled = true; btnSalvar.innerText = 'Salvando...'; }
            await adicionarLinhaNaPlanilha(novoRegistro);
            await sincronizarDaPlanilha();
        } catch (erro) {
            console.error('Erro ao salvar na planilha compartilhada:', erro);
            alert('Falha ao salvar na lista compartilhada. Verifique sua internet e tente de novo.');
            return;
        } finally {
            if (btnSalvar) { btnSalvar.disabled = false; btnSalvar.innerText = 'Salvar Registro'; }
        }
    } else {
        let historico = JSON.parse(localStorage.getItem('secretaria_db')) || [];
        historico.push(novoRegistro);
        localStorage.setItem('secretaria_db', JSON.stringify(historico));
        registrosCache = historico;
        atualizarTabelaTela();
    }

    document.getElementById('form-registro').reset();
    document.getElementById('campo-busca').value = '';
    esconderCamposReincidencia();
    alternarCamposPorTipo();
    alert("Salvo com sucesso!");
}

function criarBotaoWhats(reg) {
    if (!reg.telefone) {
        return `<span style="color:#aaa; font-size:12px;">Sem fone</span>`;
    }

    let mensagem = `Olá! Informamos que o(a) aluno(a) *${reg.aluno}* (Turma: ${reg.turma}) registrou um *ATRASO* de entrada às *${reg.horario}*.\nSituação: ${reg.motivo}`;
    if (reg.tipo === "SAÍDA") {
        mensagem = `Olá! Informamos que o(a) aluno(a) *${reg.aluno}* (Turma: ${reg.turma}) teve uma *SAÍDA ANTECIPADA* às *${reg.horario}*.\nMotivo: ${reg.motivo}`;
    } else if (reg.tipo === "OCORRENCIA") {
        mensagem = `Olá! Informamos que o(a) aluno(a) *${reg.aluno}* (Turma: ${reg.turma}) teve uma *OCORRÊNCIA* registrada às *${reg.horario}* (Local: ${reg.local}).\nDescrição: ${reg.motivo}\nRegistrado por: ${reg.autorizado}`;
    }

    const link = `https://api.whatsapp.com/send?phone=55${reg.telefone}&text=${encodeURIComponent(mensagem)}`;
    return `<a href="${link}" target="_blank" class="btn-whatsapp">📲 Enviar</a>`;
}

function classeBadge(tipo) {
    if (tipo === 'SAÍDA') return 'badge-saida';
    if (tipo === 'OCORRENCIA') return 'badge-ocorrencia';
    return 'badge-atraso';
}

function linhaTabela(reg) {
    const classe = classeBadge(reg.tipo);
    const btnWhats = criarBotaoWhats(reg);
    return `
        <tr>
            <td><strong>${escaparHTML(reg.horario)}</strong><br><span class="badge ${classe}">${escaparHTML(reg.tipo)}</span><br><small style="color:#777;">${escaparHTML(reg.data || '-')}</small></td>
            <td>${escaparHTML(reg.aluno)}</td>
            <td>${escaparHTML(reg.turma)}</td>
            <td>${btnWhats}</td>
        </tr>
    `;
}

function atualizarTabelaTela() {
    const lista = document.getElementById('lista-ocorrencias');
    const historico = obterHistorico();
    lista.innerHTML = '';

    if (historico.length === 0) {
        lista.innerHTML = `<tr><td colspan="4" style="text-align:center;color:#777;">Sem registros.</td></tr>`;
        return;
    }

    [...historico].reverse().forEach(reg => {
        lista.innerHTML += linhaTabela(reg);
    });
}

function filtrarRegistros() {
    const termoBusca = document.getElementById('campo-busca').value.toLowerCase().trim();
    const lista = document.getElementById('lista-ocorrencias');
    const historico = obterHistorico();

    lista.innerHTML = '';

    const registrosFiltrados = [...historico].reverse().filter(reg => {
        return reg.aluno.toLowerCase().includes(termoBusca) ||
               reg.turma.toLowerCase().includes(termoBusca) ||
               reg.matricula.toLowerCase().includes(termoBusca);
    });

    if (registrosFiltrados.length === 0) {
        lista.innerHTML = `<tr><td colspan="4" style="text-align:center;color:#777;">Nenhum registro encontrado.</td></tr>`;
        return;
    }

    registrosFiltrados.forEach(reg => {
        lista.innerHTML += linhaTabela(reg);
    });
}

function exportarParaCSV() {
    const historico = obterHistorico();
    if (historico.length === 0) return alert("Sem dados para exportar.");

    let csv = "\uFEFFDATA;HORARIO;TIPO;ALUNO;MATRICULA;TURMA;LOCAL;TELEFONE;MOTIVO;AUTORIZADO/REGISTRADO POR\r\n";
    historico.forEach(reg => {
        csv += `"${reg.data || '-'}";"${reg.horario}";"${reg.tipo}";"${reg.aluno}";"${reg.matricula}";"${reg.turma}";"${reg.local || '-'}";"${reg.telefone}";"${reg.motivo}";"${reg.autorizado || '-'}"\r\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `relatorio_secretaria_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
}

function gerarPlanilhaXLSX() {
    const historico = obterHistorico();
    const linhas = historico.map(reg => ({
        Data: reg.data || '-',
        Horario: reg.horario,
        Tipo: reg.tipo,
        Aluno: reg.aluno,
        Matricula: reg.matricula,
        Turma: reg.turma,
        Local: reg.local || '-',
        Telefone: reg.telefone,
        Motivo: reg.motivo,
        'Autorizado/Registrado por': reg.autorizado
    }));
    const planilha = XLSX.utils.json_to_sheet(linhas);
    planilha['!cols'] = [{ wch: 10 }, { wch: 8 }, { wch: 12 }, { wch: 25 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 14 }, { wch: 30 }, { wch: 16 }];
    const livro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(livro, planilha, 'Registros');
    return livro;
}

function exportarParaXLSX() {
    const historico = obterHistorico();
    if (historico.length === 0) return alert("Sem dados para exportar.");

    if (typeof XLSX === 'undefined') {
        alert('A biblioteca de exportação XLSX não carregou. Verifique sua conexão com a internet.');
        return;
    }

    const livro = gerarPlanilhaXLSX();
    XLSX.writeFile(livro, `relatorio_secretaria_${new Date().toISOString().split('T')[0]}.xlsx`);
}

function criarTokenClientSeNecessario() {
    if (googleTokenClient) return true;
    if (typeof google === 'undefined' || !google.accounts) {
        return false;
    }
    googleTokenClient = google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: `${GOOGLE_DRIVE_SCOPE} ${GOOGLE_SHEETS_SCOPE}`,
        callback: () => {}
    });
    return true;
}

function pedirAcessoGoogle() {
    return new Promise((resolve, reject) => {
        if (!GOOGLE_CLIENT_ID || GOOGLE_CLIENT_ID.includes('SEU_CLIENT_ID_AQUI')) {
            reject(new Error('Configure o GOOGLE_CLIENT_ID no topo do app.js antes de usar o login do Google.'));
            return;
        }
        if (!criarTokenClientSeNecessario()) {
            reject(new Error('O login do Google ainda não carregou. Verifique sua conexão e tente novamente em alguns segundos.'));
            return;
        }
        googleTokenClient.callback = (resposta) => {
            if (resposta.error) {
                reject(new Error(resposta.error));
                return;
            }
            googleAccessToken = resposta.access_token;
            resolve(googleAccessToken);
        };
        googleTokenClient.requestAccessToken({ prompt: googleAccessToken ? '' : 'consent' });
    });
}

const NOME_PASTA_BACKUP = 'Backups Secretaria';

async function obterOuCriarPastaBackup() {
    if (ID_PASTA_COMPARTILHADA_DRIVE) {
        return ID_PASTA_COMPARTILHADA_DRIVE;
    }

    const busca = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
            `name='${NOME_PASTA_BACKUP}' and mimeType='application/vnd.google-apps.folder' and trashed=false`
        )}&fields=files(id,name)`,
        { headers: { Authorization: `Bearer ${googleAccessToken}` } }
    );
    if (!busca.ok) throw new Error(await busca.text());
    const resultado = await busca.json();

    if (resultado.files && resultado.files.length > 0) {
        return resultado.files[0].id;
    }

    const criacao = await fetch('https://www.googleapis.com/drive/v3/files', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${googleAccessToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            name: NOME_PASTA_BACKUP,
            mimeType: 'application/vnd.google-apps.folder'
        })
    });
    if (!criacao.ok) throw new Error(await criacao.text());
    const pastaNova = await criacao.json();
    return pastaNova.id;
}

async function salvarNoGoogleDrive() {
    if (typeof XLSX === 'undefined') {
        alert('A biblioteca de exportação XLSX não carregou. Verifique sua conexão com a internet.');
        return;
    }
    const historico = obterHistorico();
    if (historico.length === 0) {
        alert('Sem dados para enviar.');
        return;
    }

    try {
        await pedirAcessoGoogle();
        await enviarArquivoParaDrive();
    } catch (erro) {
        console.error(erro);
        alert(erro.message || 'Não foi possível conectar ao Google Drive.');
    }
}

async function enviarArquivoParaDrive() {
    const livro = gerarPlanilhaXLSX();
    const arrayBuffer = XLSX.write(livro, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([arrayBuffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
    const nomeArquivo = `relatorio_secretaria_${new Date().toISOString().split('T')[0]}.xlsx`;

    try {
        const pastaId = await obterOuCriarPastaBackup();

        const metadata = {
            name: nomeArquivo,
            mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            parents: [pastaId]
        };

        const form = new FormData();
        form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
        form.append('file', blob);

        const resposta = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
            method: 'POST',
            headers: { Authorization: `Bearer ${googleAccessToken}` },
            body: form
        });
        if (!resposta.ok) {
            const erroTexto = await resposta.text();
            throw new Error(erroTexto);
        }
        alert(`Backup enviado para o Google Drive com sucesso! ✅${ID_PASTA_COMPARTILHADA_DRIVE ? ' (pasta compartilhada do gestor)' : ` (pasta "${NOME_PASTA_BACKUP}")`}`);
    } catch (erro) {
        console.error('Erro ao enviar para o Drive:', erro);
        alert('Falha ao enviar para o Google Drive. Veja o console (F12) para detalhes.');
    }
}

async function garantirCabecalhoPlanilha() {
    const resp = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${ID_PLANILHA_COMPARTILHADA}/values/${ABA_PLANILHA}!A1:J1`,
        { headers: { Authorization: `Bearer ${googleAccessToken}` } }
    );
    if (!resp.ok) throw new Error(await resp.text());
    const dados = await resp.json();
    if (!dados.values || dados.values.length === 0) {
        const escrita = await fetch(
            `https://sheets.googleapis.com/v4/spreadsheets/${ID_PLANILHA_COMPARTILHADA}/values/${ABA_PLANILHA}!A1:J1?valueInputOption=RAW`,
            {
                method: 'PUT',
                headers: {
                    Authorization: `Bearer ${googleAccessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ values: [CABECALHO_PLANILHA] })
            }
        );
        if (!escrita.ok) throw new Error(await escrita.text());
    }
}

async function carregarRegistrosDaPlanilha() {
    const resp = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${ID_PLANILHA_COMPARTILHADA}/values/${ABA_PLANILHA}!A2:J`,
        { headers: { Authorization: `Bearer ${googleAccessToken}` } }
    );
    if (!resp.ok) throw new Error(await resp.text());
    const dados = await resp.json();
    const linhas = dados.values || [];
    return linhas.map(linha => ({
        data: linha[0] || '',
        horario: linha[1] || '',
        tipo: linha[2] || '',
        aluno: linha[3] || '',
        matricula: linha[4] || '',
        turma: linha[5] || '',
        local: linha[6] || '-',
        telefone: linha[7] || '',
        motivo: linha[8] || '',
        autorizado: linha[9] || '-'
    }));
}

async function adicionarLinhaNaPlanilha(reg) {
    const linha = [reg.data, reg.horario, reg.tipo, reg.aluno, reg.matricula, reg.turma, reg.local, reg.telefone, reg.motivo, reg.autorizado];
    const resp = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${ID_PLANILHA_COMPARTILHADA}/values/${ABA_PLANILHA}!A:J:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
        {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${googleAccessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ values: [linha] })
        }
    );
    if (!resp.ok) throw new Error(await resp.text());
}

async function sincronizarDaPlanilha() {
    try {
        registrosCache = await carregarRegistrosDaPlanilha();
        atualizarTabelaTela();
        const textoSync = document.getElementById('texto-ultima-sync');
        if (textoSync) {
            const agora = new Date();
            textoSync.innerText = `atualizado às ${agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
        }
    } catch (erro) {
        console.error('Erro ao sincronizar com a planilha:', erro);
        const textoSync = document.getElementById('texto-ultima-sync');
        if (textoSync) textoSync.innerText = 'falha ao atualizar — verifique a internet';
    }
}

function iniciarPolling() {
    if (intervalPolling) clearInterval(intervalPolling);
    intervalPolling = setInterval(sincronizarDaPlanilha, INTERVALO_ATUALIZACAO_MS);
}

async function entrarNoModoCompartilhado() {
    const botao = document.querySelector('#area-login-google button');
    try {
        if (botao) { botao.disabled = true; botao.innerText = 'Conectando...'; }
        await pedirAcessoGoogle();
        await garantirCabecalhoPlanilha();
        await sincronizarDaPlanilha();
        iniciarPolling();

        document.getElementById('area-login-google').style.display = 'none';
        const statusSync = document.getElementById('status-sincronizacao');
        if (statusSync) statusSync.style.display = 'flex';
    } catch (erro) {
        console.error(erro);
        alert(erro.message || 'Não foi possível conectar à planilha compartilhada. Veja o console (F12).');
    } finally {
        if (botao) { botao.disabled = false; botao.innerText = 'Entrar com Google'; }
    }
}
