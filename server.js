const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');

const app = express();
const DB_FILE = path.join(__dirname, 'banco.json');

// Configurações
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('.'));

// Serviços padrão
const servicosPadrao = [
    { descricao: 'Alongamento em Gel', preco: 170, tempo_estimado: 150 },
    { descricao: 'Esmaltação em Gel', preco: 70, tempo_estimado: 90 },
    { descricao: 'Blindagem com Esmaltação em Gel', preco: 90, tempo_estimado: 90 },
    { descricao: 'Esmaltação Normal Pé e Mão', preco: 50, tempo_estimado: 60 },
    { descricao: 'Esmaltação Normal Mão', preco: 30, tempo_estimado: 30 },
    { descricao: 'Esmaltação Normal Pé', preco: 30, tempo_estimado: 30 },
    { descricao: 'Cabelo Corte com Escova', preco: 50, tempo_estimado: 30 },
    { descricao: 'Hidratação', preco: 60, tempo_estimado: 60 }
];

// ---------- Banco de dados em JSON ----------
function lerBanco() {
    try {
        if (fs.existsSync(DB_FILE)) {
            return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
        }
    } catch (e) {
        console.error('Erro ao ler banco:', e.message);
    }
    return { clientes: [], servicos: [], agendamentos: [], itens_agendamento: [], nextId: { clientes: 1, servicos: 1, agendamentos: 1, itens: 1 } };
}

function salvarBanco(data) {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// Inicializa o banco e cadastra serviços padrão
function inicializarBanco() {
    const db = lerBanco();

    servicosPadrao.forEach(s => {
        const existe = db.servicos.find(x => x.descricao === s.descricao);
        if (!existe) {
            db.servicos.push({
                id: db.nextId.servicos++,
                descricao: s.descricao,
                preco: s.preco,
                tempo_estimado: s.tempo_estimado
            });
            console.log('✅ Serviço cadastrado:', s.descricao);
        }
    });

    salvarBanco(db);
    return db;
}

inicializarBanco();

/* ==========================================================================
   ROTAS: CLIENTES
   ========================================================================== */

app.post('/salvar-cliente', (req, res) => {
    const { nome, cpf, telefone } = req.body;
    const db = lerBanco();
    db.clientes.push({
        id: db.nextId.clientes++,
        nome: nome || '',
        cpf: cpf || '-',
        telefone: telefone || '-'
    });
    salvarBanco(db);
    res.redirect('/clientes.html');
});

app.get('/listar-clientes', (req, res) => {
    const db = lerBanco();
    res.json(db.clientes.sort((a, b) => a.nome.localeCompare(b.nome)));
});

/* ==========================================================================
   ROTAS: SERVIÇOS
   ========================================================================== */

app.post('/salvar-servico', (req, res) => {
    const { descricao, preco, tempo_estimado } = req.body;

    if (!descricao || preco === undefined || preco === '' || tempo_estimado === undefined || tempo_estimado === '') {
        return res.status(400).json({ success: false, error: 'Preencha todos os campos.' });
    }

    const db = lerBanco();
    const novo = {
        id: db.nextId.servicos++,
        descricao: descricao.trim(),
        preco: parseFloat(preco),
        tempo_estimado: parseInt(tempo_estimado, 10)
    };
    db.servicos.push(novo);
    salvarBanco(db);
    res.json({ success: true, id: novo.id });
});

app.get('/listar-servicos', (req, res) => {
    const db = lerBanco();
    res.json(db.servicos.sort((a, b) => a.descricao.localeCompare(b.descricao)));
});

/* ==========================================================================
   ROTAS: AGENDAMENTOS
   ========================================================================== */

app.post('/finalizar-agendamento', (req, res) => {
    const { cliente_id, nome_cliente, data, responsavel, total, tempo_total, servicos } = req.body;

    if (!data || !responsavel) {
        return res.status(400).json({ success: false, error: 'Data e responsável são obrigatórios.' });
    }
    if (!Array.isArray(servicos) || servicos.length === 0) {
        return res.status(400).json({ success: false, error: 'Adicione pelo menos um serviço.' });
    }

    const db = lerBanco();

    // Cria ou usa o cliente
    let idCliente = cliente_id;
    if (nome_cliente && String(nome_cliente).trim()) {
        const nome = String(nome_cliente).trim();
        idCliente = db.nextId.clientes++;
        db.clientes.push({
            id: idCliente,
            nome: nome,
            cpf: '-',
            telefone: '-'
        });
    }

    if (!idCliente) {
        return res.status(400).json({ success: false, error: 'Informe o nome da cliente.' });
    }

    // Cria o agendamento
    const agendamentoId = db.nextId.agendamentos++;
    db.agendamentos.push({
        id: agendamentoId,
        cliente_id: idCliente,
        data: data,
        responsavel: responsavel,
        total: parseFloat(total) || 0,
        tempo_total: parseInt(tempo_total, 10) || 0
    });

    // Cria os itens
    servicos.forEach(item => {
        db.itens_agendamento.push({
            id: db.nextId.itens++,
            agendamento_id: agendamentoId,
            servico_id: parseInt(item.id, 10),
            preco_cobrado: parseFloat(item.preco)
        });
    });

    salvarBanco(db);
    res.json({ success: true, id: agendamentoId });
});

app.get('/listar-agendamentos', (req, res) => {
    const db = lerBanco();
    const lista = db.agendamentos.map(a => {
        const cliente = db.clientes.find(c => c.id === a.cliente_id);
        return {
            id: a.id,
            data: a.data,
            responsavel: a.responsavel,
            total: a.total,
            tempo_total: a.tempo_total,
            nome_cliente: cliente ? cliente.nome : 'Cliente'
        };
    });
    // Mais recentes primeiro
    lista.sort((a, b) => b.id - a.id);
    res.json(lista);
});

app.get('/detalhes-agendamento/:id', (req, res) => {
    const db = lerBanco();
    const id = parseInt(req.params.id, 10);
    const itens = db.itens_agendamento
        .filter(i => i.agendamento_id === id)
        .map(i => {
            const servico = db.servicos.find(s => s.id === i.servico_id);
            return {
                preco_cobrado: i.preco_cobrado,
                descricao: servico ? servico.descricao : 'Serviço',
                tempo_estimado: servico ? servico.tempo_estimado : 0
            };
        });
    res.json(itens);
});

// Inicialização do Servidor
app.listen(3000, () => {
    console.log('====================================================');
    console.log('🚀 Salão Belíssima rodando na porta 3000!');
    console.log('📂 Banco de dados: banco.json');
    console.log('🌐 Acesse: http://localhost:3000');
    console.log('====================================================');
});
